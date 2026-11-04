import { createStore } from "./store.js";
import { createPaper, SLOT_COLORS } from "./paper.js";
import { schedule, elapsedMin, fmt, words, esc, ROUNDS, SLOT_NAMES } from "./common.js";
import { DEFAULT_SCHEDULE, HOST_EMAIL } from "./config.js";
import { toPng } from "html-to-image";
import JSZip from "jszip";

const store = createStore();
const $ = (s) => document.querySelector(s);
const app = $("#app");

let sid = null, session = null, sessions = [];
let people = {}, priv = {}, pieces = {}, notes = {}, names = {};
let pieceSubs = {};
let sessUnsubs = [];

async function boot() {
  app.innerHTML = `<div class="center-card"><p class="muted">Connecting…</p></div>`;
  let email = null;
  try { email = await store.initHost(false); } catch (e) { console.error(e); }
  if (!email) return signInScreen();
  if (email.toLowerCase() !== HOST_EMAIL) {
    app.innerHTML = `<div class="center-card"><h2>Not authorized</h2><p>You're signed in as ${esc(email)}. The host screen is only for ${HOST_EMAIL}.</p><button class="btn" id="so">Sign out</button></div>`;
    $("#so").onclick = async () => { await store.signOut(); location.reload(); };
    return;
  }
  layout();
  store.watchDoc("config/current", (c) => { const n = c && c.sessionId; if (n !== sid) attach(n); renderSessions(); });
  store.watchColl("sessions", (ss) => { sessions = ss.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); renderSessions(); });
  setInterval(renderClock, 500);
}

function signInScreen() {
  app.innerHTML = `<div class="center-card"><div class="kicker">Host</div><h1>I Want to Feel More Alive</h1>
    <p>Sign in with ${HOST_EMAIL} to run the session.</p><button class="btn primary big" id="si">Sign in with Google</button><p id="err" class="fine"></p></div>`;
  $("#si").onclick = async () => {
    try { const em = await store.initHost(true); if (em) location.reload(); }
    catch (e) { $("#err").textContent = e.message; }
  };
}

function layout() {
  const link = new URL(".", location.href).href;
  app.innerHTML = `
  <div class="host">
    <header class="host-h">
      <div><div class="kicker">Host · An exercise with the Academy for Teachers</div><h1 class="hh">I Want to Feel More Alive</h1></div>
      <div class="clock-box"><div class="clock" id="clock">—</div><div class="phase" id="phase"></div></div>
    </header>
    <section class="panel">
      <div class="row-between">
        <div><b>Participant link:</b> <a href="${link}" target="_blank" id="plink">${link}</a> <button class="btn small" id="copy">Copy</button></div>
        <div class="sess-pick" id="sesspick"></div>
      </div>
    </section>
    <section class="panel" id="controls"></section>
    <section class="panel"><h3>People <span class="muted" id="counts"></span></h3><div id="table"></div></section>
    <section class="panel"><div class="row-between"><h3>Pages</h3><div><button class="btn small" id="csv">Download spreadsheet (CSV)</button> <button class="btn small primary" id="zip">Download everything (ZIP of pages + spreadsheets)</button></div></div><div id="gallery" class="gallery"></div></section>
  </div>
  <div id="modal" class="modal" hidden><div class="modal-bar"><b id="mtitle"></b><span><button class="btn small" id="mpng">Download PNG</button> <button class="btn small" id="mclose">Close</button></span></div><div id="mvp" class="mvp"></div></div>
  <div id="offscreen" class="offscreen"></div>`;
  $("#copy").onclick = () => { navigator.clipboard.writeText(link); $("#copy").textContent = "Copied"; setTimeout(() => ($("#copy").textContent = "Copy"), 1500); };
  $("#mclose").onclick = () => { $("#modal").hidden = true; $("#mvp").innerHTML = ""; };
  $("#csv").onclick = () => download(`most-alive-${slug()}.csv`, new Blob([piecesCsv()], { type: "text/csv" }));
  $("#zip").onclick = exportZip;
}

function renderSessions() {
  const el = $("#sesspick"); if (!el) return;
  el.innerHTML = `<label>Session: <select id="sel">${sessions.map((s) => `<option value="${s.id}" ${s.id === sid ? "selected" : ""}>${esc(s.label || s.id)}${s.startedAt ? " (started)" : ""}</option>`).join("")}${sid ? "" : `<option selected value="">— none open —</option>`}</select></label>
    <button class="btn small" id="newsess">+ New session</button>`;
  $("#sel").onchange = async (e) => {
    if (!e.target.value) return;
    if (!confirm("Switch participants to this session? Anyone on the link will move to it.")) { renderSessions(); return; }
    await store.set("config/current", { sessionId: e.target.value });
  };
  $("#newsess").onclick = async () => {
    const label = prompt("Name this session (e.g. “Practice” or “Live — AFT 5pm”):", sessions.length ? "Live — AFT 5pm" : "Practice");
    if (!label) return;
    const id = "s" + Date.now().toString(36);
    await store.set(`sessions/${id}`, { label, createdAt: store.now(), startedAt: null, schedule: DEFAULT_SCHEDULE, returnedAll: false, endReading: false });
    await store.set("config/current", { sessionId: id });
  };
}

function attach(newSid) {
  sessUnsubs.forEach((u) => u()); sessUnsubs = [];
  Object.values(pieceSubs).forEach((us) => us.forEach((u) => u())); pieceSubs = {};
  sid = newSid; session = null; people = {}; priv = {}; pieces = {}; notes = {}; names = {};
  if (!sid) { renderAll(); return; }
  sessUnsubs.push(store.watchDoc(`sessions/${sid}`, (s) => { session = s; renderControls(); renderAll(); }));
  sessUnsubs.push(store.watchColl(`sessions/${sid}/people`, (ps) => { people = Object.fromEntries(ps.map((p) => [p.id, p])); renderAll(); }));
  sessUnsubs.push(store.watchColl(`sessions/${sid}/private`, (ps) => { priv = Object.fromEntries(ps.map((p) => [p.id, p])); renderAll(); }));
  sessUnsubs.push(store.watchColl(`sessions/${sid}/pieces`, (ps) => {
    pieces = Object.fromEntries(ps.map((p) => [p.id, p]));
    for (const p of ps) if (!pieceSubs[p.id]) {
      pieceSubs[p.id] = [
        store.watchColl(`sessions/${sid}/pieces/${p.id}/notes`, (ns) => { notes[p.id] = ns; renderGallery(); }),
        store.watchColl(`sessions/${sid}/pieces/${p.id}/names`, (ns) => { names[p.id] = ns; renderAll(); }),
      ];
    }
    renderAll();
  }));
}

const nameOf = (uid) => (priv[uid] && priv[uid].firstName) || "(unnamed)";
function readerName(pid, slot) {
  const p = pieces[pid]; if (!p) return "";
  const uid = (p.readers || [])[slot - 1];
  return uid ? nameOf(uid) : "";
}

function renderControls() {
  const el = $("#controls"); if (!el) return;
  if (!sid || !session) { el.innerHTML = `<p>No session is open. Click <b>+ New session</b> to create one — participants on the link will see it immediately.</p>`; return; }
  const sch = schedule(session);
  if (!session.startedAt) {
    const f = (k, sub) => `<input type="number" step="0.5" min="0" data-k="${k}" data-s="${sub || ""}" value="${sub ? sch[k][sub] : sch[k]}">`;
    el.innerHTML = `
      <div class="row-between"><h3>${esc(session.label)} — not started</h3><button class="btn primary big-inline" id="start">Start the clock</button></div>
      <p class="muted">People can join now and will wait on a welcome screen. Times are minutes after you click Start.</p>
      <table class="sched"><tr><th></th><th>Submit unlocks</th><th>“Finish up” banner</th><th>Target</th></tr>
        <tr><td>Writing</td><td>${f("write", "unlock")}</td><td>${f("write", "warn")}</td><td>${f("write", "target")}</td></tr>
        <tr><td>Round 1</td><td>${f("r1", "unlock")}</td><td>${f("r1", "warn")}</td><td>${f("r1", "target")}</td></tr>
        <tr><td>Round 2</td><td>${f("r2", "unlock")}</td><td>${f("r2", "warn")}</td><td>${f("r2", "target")}</td></tr>
        <tr><td>Round 3</td><td>${f("r3", "unlock")}</td><td>${f("r3", "warn")}</td><td>${f("r3", "target")}</td></tr>
        <tr><td>End (own pages)</td><td>${f("end")}</td><td></td><td></td></tr>
        <tr><td>Doors close</td><td>${f("doors")}</td><td></td><td></td></tr></table>`;
    el.querySelectorAll("input").forEach((inp) => inp.onchange = async () => {
      const s = JSON.parse(JSON.stringify(sch));
      const v = parseFloat(inp.value); if (isNaN(v)) return;
      if (inp.dataset.s) s[inp.dataset.k][inp.dataset.s] = v; else s[inp.dataset.k] = v;
      await store.update(`sessions/${sid}`, { schedule: s });
    });
    $("#start").onclick = async () => {
      if (!confirm("Start the clock now? Everyone who has joined will see the writing prompt.")) return;
      await store.update(`sessions/${sid}`, { startedAt: store.now() });
    };
  } else {
    el.innerHTML = `
      <div class="row-between"><h3>${esc(session.label)} — ${session.ended ? "ended" : "running"}</h3>
      <div class="ctl">
        <button class="btn small" id="back1" title="Move the clock back one minute (gives everyone more time)">− 1 min</button>
        <button class="btn small" id="fwd1" title="Jump the clock forward one minute">+ 1 min</button>
        <button class="btn small" id="release" title="Anyone stuck waiting for a second piece goes straight to their own page">Release stuck readers</button>
        <button class="btn small" id="returnall" title="Show every author their page now, whatever its state">Return all pages now</button>
        <button class="btn small danger" id="endsess" title="Everyone sees their own finished page; no more notes can be added">${session.ended ? "Session ended" : "End session"}</button>
      </div></div>
      <p class="muted small">Schedule: writing unlocks ${sch.write.unlock}′ (aim ${sch.write.target}′) · round 1 unlocks ${sch.r1.unlock}′ (aim ${sch.r1.target}′) · round 2 unlocks ${sch.r2.unlock}′ (aim ${sch.r2.target}′) · round 3 unlocks ${sch.r3.unlock}′ (aim ${sch.r3.target}′) · end ${sch.end}′ · doors closed at ${sch.doors}′${session.returnedAll ? " · <b>pages returned</b>" : ""}</p>`;
    $("#back1").onclick = () => store.update(`sessions/${sid}`, { startedAt: session.startedAt + 60000 });
    $("#fwd1").onclick = () => store.update(`sessions/${sid}`, { startedAt: session.startedAt - 60000 });
    $("#release").onclick = () => { if (confirm("Send anyone still waiting for another piece straight on to their own page?")) store.update(`sessions/${sid}`, { endReading: true }); };
    $("#endsess").disabled = !!session.ended;
    $("#endsess").onclick = () => { if (confirm("End the session now? Everyone goes to their own finished page, and no more reflections can be added. Your exports will still work.")) store.update(`sessions/${sid}`, { ended: true, endedAt: store.now(), returnedAll: true, endReading: true }); };
    $("#returnall").onclick = () => { if (confirm("Return every page to its author now? Readers still working can keep adding.")) store.update(`sessions/${sid}`, { returnedAll: true, endReading: true }); };
  }
}

function renderClock() {
  const c = $("#clock"), ph = $("#phase"); if (!c) return;
  const e = elapsedMin(session, store.now());
  if (e == null) { c.textContent = "—"; ph.textContent = session ? "Not started" : ""; return; }
  c.textContent = fmt(e * 60);
  const s = schedule(session);
  let t = "Writing";
  if (e >= s.write.target) t = "Round 1";
  if (e >= s.r1.target) t = "Round 2";
  if (e >= s.r2.target) t = "Round 3";
  if (e >= s.r3.target) t = "Reading their own pages";
  if (e >= s.end) t = "Finished — on to discussion";
  const next = [[s.write.unlock, "writing submit appears"], [s.write.target, "writing ends"], [s.r1.unlock, "round 1 can pass on"], [s.r1.target, "round 1 ends"], [s.r2.unlock, "round 2 can pass on"], [s.r2.target, "round 2 ends"], [s.r3.unlock, "round 3 can pass on"], [s.r3.target, "round 3 ends"], [s.end, "end"]].filter(([m]) => m != null).find(([m]) => m > e);
  ph.textContent = t + (next ? ` · ${next[1]} in ${fmt((next[0] - e) * 60)}` : "");
}

function phaseLabel(p) {
  if (!p) return "";
  if (p.phase === "writing") return "✍️ Writing";
  if (p.phase === "waiting") return `⏳ Waiting for piece ${(p.readsDone || 0) + 1}`;
  if (p.phase === "reading") return `📖 Reading (${(p.readsDone || 0) + 1} of ${ROUNDS})`;
  if (p.phase === "done") return "✅ Done reading";
  return p.phase;
}

function renderAll() { renderTable(); renderGallery(); }
function renderTable() {
  const el = $("#table"); if (!el) return;
  const ids = Object.keys(people).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const cnt = (ph) => ids.filter((i) => people[i].phase === ph).length;
  $("#counts").textContent = ids.length ? `· ${ids.length} joined · ${cnt("writing")} writing · ${cnt("waiting")} waiting · ${cnt("reading")} reading · ${cnt("done")} done` : "";
  if (!ids.length) { el.innerHTML = `<p class="muted">No one has joined yet.</p>`; return; }
  el.innerHTML = `<table class="ppl"><tr><th>Name</th><th>Email</th><th>Status</th><th>Now reading</th><th>Their piece</th><th>Read by</th></tr>` +
    ids.map((id) => {
      const p = people[id], pc = pieces[id] || {};
      const holding = p.holding ? `${esc(nameOf(pieces[p.holding] ? pieces[p.holding].author : p.holding))}'s` : "";
      const pstat = !pc.submitted ? `draft · ${words(pc.text)} words` : `${words(pc.text)} words · ${pc.status === "complete" ? "complete" : pc.status === "reading" ? "being read" : "waiting for a reader"}`;
      const rb = (pc.readers || []).map((r) => esc(nameOf(r))).join(", ");
      return `<tr><td>${esc(nameOf(id))}</td><td class="muted">${esc((priv[id] && priv[id].email) || "")}</td><td>${phaseLabel(p)}</td><td>${holding}</td><td>${pstat}</td><td>${rb}</td></tr>`;
    }).join("") + `</table>`;
}

function renderGallery() {
  const el = $("#gallery"); if (!el) return;
  const ids = Object.keys(pieces).filter((id) => pieces[id].submitted).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (!ids.length) { el.innerHTML = `<p class="muted">Pages appear here once people submit their writing.</p>`; return; }
  el.innerHTML = ids.map((id) => {
    const ns = notes[id] || [];
    const tops = ns.filter((n) => !n.parent).length, reps = ns.filter((n) => n.parent).length;
    return `<div class="tile"><div class="tile-h"><b>${esc(nameOf(id))}</b><span class="muted small">${words(pieces[id].text)} words</span></div>
      <div class="tile-t">${esc((pieces[id].text || "").slice(0, 220))}${(pieces[id].text || "").length > 220 ? "…" : ""}</div>
      <div class="tile-f"><span class="muted small">${tops} reflection${tops === 1 ? "" : "s"}${reps ? ` · ${reps} repl${reps === 1 ? "y" : "ies"}` : ""}</span><span><button class="btn small" data-view="${id}">View</button> <button class="btn small" data-png="${id}">PNG</button></span></div></div>`;
  }).join("");
  el.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => openPiece(b.dataset.view));
  el.querySelectorAll("[data-png]").forEach((b) => b.onclick = async () => { b.disabled = true; const blob = await pngFor(b.dataset.png); download(`${fileName(b.dataset.png)}.png`, blob); b.disabled = false; });
}

function paperOpts(id) {
  return { text: pieces[id].text, mode: "view", me: "host", mySlot: 0, heading: `${nameOf(id)}'s moment`, labelFor: (slot) => readerName(id, slot) || SLOT_NAMES[slot] || "Reader" };
}
function openPiece(id) {
  $("#modal").hidden = false;
  $("#mtitle").textContent = `${nameOf(id)}'s moment`;
  const p = createPaper($("#mvp"), paperOpts(id));
  p.setNotes(notes[id] || []);
  $("#mpng").onclick = async () => download(`${fileName(id)}.png`, await pngFor(id));
}

async function pngFor(id) {
  const host = $("#offscreen");
  host.innerHTML = ""; const vp = document.createElement("div"); vp.style.cssText = "position:absolute;inset:0"; host.append(vp);
  const p = createPaper(vp, paperOpts(id));
  p.setNotes(notes[id] || []);
  if (document.fonts) await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  p.refresh();
  const b = p.bounds();
  const url = await toPng(p.paper, {
    width: b.w, height: b.h, pixelRatio: 2, backgroundColor: "#fcfaf4",
    style: { transform: `translate(${-b.x}px, ${-b.y}px)`, boxShadow: "none", borderRadius: "0" },
  });
  host.innerHTML = "";
  return (await fetch(url)).blob();
}

function slug() { return ((session && session.label) || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function fileName(id) { return `${nameOf(id)}-${(priv[id] && priv[id].email || id).split("@")[0]}`.replace(/[^A-Za-z0-9_-]+/g, "_"); }
function download(name, blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
function piecesCsv() {
  const rows = [["First name", "Email", "Words", "Moment", "First reader", "Second reader", "Third reader", "Reflections", "Replies"]];
  for (const id of Object.keys(people).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
    const pc = pieces[id] || {}; const ns = notes[id] || [];
    rows.push([nameOf(id), priv[id] && priv[id].email, words(pc.text), pc.text, readerName(id, 1), readerName(id, 2), readerName(id, 3), ns.filter((n) => !n.parent).length, ns.filter((n) => n.parent).length]);
  }
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
function notesCsv() {
  const rows = [["Author (whose moment)", "Author email", "Reader", "Reader slot", "Type", "Highlighted phrase", "Reflection", "Replying to"]];
  for (const id of Object.keys(pieces)) {
    const ns = (notes[id] || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
    for (const n of ns) {
      const parent = n.parent ? ns.find((x) => x.id === n.parent) : null;
      rows.push([nameOf(id), priv[id] && priv[id].email, nameOf(n.by), n.slot, n.parent ? "reply" : "reflection", n.quote || (parent && parent.quote) || "", n.body, parent ? parent.body : ""]);
    }
  }
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
async function exportZip() {
  const btn = $("#zip"); btn.disabled = true; const orig = btn.textContent;
  try {
    const zip = new JSZip();
    zip.file("moments.csv", piecesCsv());
    zip.file("reflections.csv", notesCsv());
    zip.file("data.json", JSON.stringify({ session, people, private: priv, pieces, notes }, null, 2));
    const ids = Object.keys(pieces).filter((id) => pieces[id].submitted);
    let i = 0;
    for (const id of ids) {
      btn.textContent = `Rendering page ${++i} of ${ids.length}…`;
      try { zip.file(`pages/${fileName(id)}.png`, await pngFor(id)); } catch (e) { console.error("png failed", id, e); }
    }
    btn.textContent = "Zipping…";
    download(`most-alive-${slug()}.zip`, await zip.generateAsync({ type: "blob" }));
  } finally { btn.disabled = false; btn.textContent = orig; }
}

void SLOT_COLORS;
boot();
