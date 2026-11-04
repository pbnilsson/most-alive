import { createStore } from "./store.js";
import { createPaper, SLOT_COLORS } from "./paper.js";
import { schedule, elapsedMin, fmt, words, gate, esc, ROUNDS, ROUND_KEYS, SLOT_NAMES } from "./common.js";

const store = createStore();
const $ = (s) => document.querySelector(s);
const main = $("#main");
const bar = $("#bar");

let me = null, sid = null;
let session = null, person = null, pieces = [], myPrivate = null;
let unsubs = [];
let view = null; // current view key
let viewCtx = {}; // per-view state
let busy = false;
let viewUnsubs = [];

const LS = (k) => `most-alive:${sid}:${k}`;
const lsGet = (k) => { try { return localStorage.getItem(LS(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS(k), v); } catch {} };

function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.append(t); setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 4200);
}

// ---------------- boot ----------------
async function boot() {
  main.innerHTML = `<div class="center-card"><p class="muted">Connecting…</p></div>`;
  try { me = await store.initAnon(); }
  catch (e) { main.innerHTML = `<div class="center-card"><h2>Couldn't connect</h2><p>Please refresh the page. (${esc(e.message)})</p></div>`; return; }
  const forced = new URLSearchParams(location.search).get("s");
  if (forced) return attach(forced);
  store.watchDoc("config/current", (c) => {
    const next = c && c.sessionId;
    if (next && next !== sid) attach(next);
    if (!next) { sid = null; render(); }
  });
}

function attach(newSid) {
  unsubs.forEach((u) => u()); unsubs = [];
  sid = newSid; session = null; person = null; pieces = []; view = null;
  unsubs.push(store.watchDoc(`sessions/${sid}`, (s) => { session = s; render(); }));
  unsubs.push(store.watchDoc(`sessions/${sid}/people/${me}`, (p) => { person = p; render(); }));
  unsubs.push(store.watchColl(`sessions/${sid}/pieces`, (ps) => { pieces = ps; render(); matchmake(); }));
  store.get(`sessions/${sid}/private/${me}`).then((p) => { myPrivate = p; }).catch(() => {});
}

setInterval(() => { tick(); matchmakeTimer(); }, 1000);

// ---------------- view selection ----------------
function currentView() {
  if (!sid) return "nosession";
  if (!session) return "loading";
  const e = elapsedMin(session, store.now());
  const sch = schedule(session);
  if (session.ended) return person ? "return" : "ended";
  if (!person) {
    if (e != null && e >= sch.doors) return "closed";
    return "join";
  }
  if (!session.startedAt) return "lobby";
  if (person.phase === "writing") return "writing";
  if (person.phase === "waiting") return "waiting";
  if (person.phase === "reading" && person.holding) return "reading:" + person.holding;
  if (person.phase === "done") {
    const mine = pieces.find((p) => p.id === me);
    const back = session.returnedAll || (mine && mine.status === "complete") || (e != null && e >= sch[ROUND_KEYS[ROUNDS - 1]].target + 1.5 && mine && !mine.reader);
    return back ? "return" : "returnwait";
  }
  return "loading";
}

function render() {
  const v = currentView();
  if (v !== view) {
    unsubsView();
    view = v; viewCtx = {};
    const [name, arg] = v.split(":");
    (views[name] || views.loading)(arg);
  }
  tick();
}

// ---------------- top bar ----------------
function setBar(html) { bar.innerHTML = html; }
function tick() {
  if (!view) return;
  const e = elapsedMin(session, store.now());
  const sch = schedule(session);
  const name = view.split(":")[0];
  const status = $("#status"), submit = $("#submit");
  if (!status) return;
  let step = null;
  if (name === "writing") step = sch.write;
  if (name === "reading") step = sch[ROUND_KEYS[Math.min(ROUNDS - 1, (person && person.readsDone) || 0)]];
  if (!step) return;
  const g = gate(step, e);
  const banner = $("#banner");
  if (g.state === "locked") {
    status.innerHTML = name === "writing"
      ? `Take your time. The submit button will appear at the ${step.unlock}-minute mark.`
      : `Keep reading and reflecting — you can pass it on in <b>${fmt(g.secs)}</b>`;
    status.className = "status";
  } else if (g.state === "open") {
    status.innerHTML = name === "writing" ? `You may submit when you're ready` : `You may pass it on when you're ready`;
    status.className = "status open";
  } else if (g.state === "warn") {
    status.innerHTML = `Please finish up — <b>${fmt(g.secs)}</b>`;
    status.className = "status warn";
  } else {
    status.innerHTML = name === "writing" ? `Time to submit — finish your sentence and send it on` : `Time to pass it on — finish your thought and send it`;
    status.className = "status warn";
  }
  if (banner) {
    const show = g.state === "warn" || g.state === "over";
    banner.classList.toggle("show", show);
    if (show) banner.innerHTML = g.state === "warn"
      ? `<b>Great — please finish within the next minute.</b> <span class="cd">${fmt(g.secs)}</span>`
      : `<b>Time to move on.</b> Finish your thought and click “${name === "writing" ? "Submit my moment" : "Pass it on"}”.`;
  }
  if (submit) {
    submit.disabled = g.locked || busy || (viewCtx.canSubmit && !viewCtx.canSubmit());
    submit.title = g.locked ? "This unlocks when the timer reaches zero" : "";
    if (name === "writing") submit.style.visibility = g.locked ? "hidden" : "visible";
  }
}

// ---------------- views ----------------
const header = (sub = "") => `
  <header class="masthead">
    <div class="kicker">An exercise with the Academy for Teachers · Peter Nilsson</div>
    <h1>I Want to Feel More Alive</h1>
    ${sub}
  </header>`;

const views = {
  loading() { setBar(""); main.className = ""; main.innerHTML = `<div class="center-card"><p class="muted">Loading…</p></div>`; },
  nosession() { setBar(""); main.className = ""; main.innerHTML = `<div class="center-card">${header()}<p>The session hasn't opened yet. This page will update on its own.</p></div>`; },
  ended() { setBar(""); main.className = ""; main.innerHTML = `<div class="center-card">${header()}<p>This session has ended. Thank you for being part of it.</p></div>`; },
  closed() { setBar(""); main.className = ""; main.innerHTML = `<div class="center-card">${header()}<p>This session is already underway, and the doors have closed. Thank you for coming — please stay with us for the discussion that follows.</p></div>`; },

  join() {
    setBar(""); main.className = "";
    main.innerHTML = `<div class="center-card">${header()}
      <form id="join" class="join">
        <label>First name<input name="first" required maxlength="40" autocomplete="given-name"></label>
        <label>Email<input name="email" type="email" required maxlength="120" autocomplete="email"></label>
        <p class="fine">Your name and email are seen only by Peter. Your writing will be read anonymously by three other participants.</p>
        <button class="btn primary big" type="submit">Join</button>
      </form></div>`;
    $("#join").onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const firstName = String(f.get("first")).trim(), email = String(f.get("email")).trim();
      if (!firstName) return;
      ev.target.querySelector("button").disabled = true;
      try {
        const e = elapsedMin(session, store.now());
        if (e != null && e >= schedule(session).doors) { render(); return; }
        await store.set(`sessions/${sid}/private/${me}`, { firstName, email, at: store.now() });
        myPrivate = { firstName, email };
        await store.set(`sessions/${sid}/pieces/${me}`, { author: me, text: "", status: "draft", readers: [], reader: null, submitted: false, createdAt: store.now() });
        await store.set(`sessions/${sid}/people/${me}`, { phase: "writing", readsDone: 0, holding: null, joinedAt: store.now() });
      } catch (err) {
        console.error(err); alert("Something went wrong joining. Please try again.");
        ev.target.querySelector("button").disabled = false;
      }
    };
  },

  lobby() {
    setBar(""); main.className = "";
    const nm = myPrivate ? esc(myPrivate.firstName) : "";
    main.innerHTML = `<div class="center-card">${header()}
      <p class="lead">Welcome${nm ? ", " + nm : ""}. You're in.</p>
      <p>When Peter starts the clock, a single question will appear here, and you'll have about nine minutes to write.</p>
      <p class="muted pulse">Waiting for Peter to begin…</p></div>`;
  },

  writing() {
    main.className = "writing";
    setBar(`<div class="brand">I Want to Feel More Alive</div><div id="status" class="status"></div><button id="submit" class="btn primary" disabled>Submit my moment</button>`);
    const mine = pieces.find((p) => p.id === me);
    const saved = lsGet("draft");
    const initial = (mine && mine.text && mine.text.length >= (saved || "").length) ? mine.text : (saved || "");
    main.innerHTML = `
      <div id="banner" class="banner"></div>
      <div class="write-wrap">
        <div class="prompt">
          <div class="kicker">The question</div>
          <h2>What is a moment in your life when you felt most alive?</h2>
          <p>Describe the moment — where you were, what was happening — and what about it made you feel so alive.</p>
        </div>
        <div class="sheet">
          <textarea id="ta" spellcheck="true" placeholder="Begin writing here…"></textarea>
          <div class="wc"><span id="wc">0</span> words · saved automatically</div>
        </div>
      </div>`;
    const ta = $("#ta");
    ta.value = initial;
    $("#wc").textContent = words(ta.value);
    let dirty = false;
    ta.oninput = () => { dirty = true; lsSet("draft", ta.value); $("#wc").textContent = words(ta.value); tick(); };
    viewCtx.canSubmit = () => words(ta.value) >= 5;
    const iv = setInterval(async () => {
      if (view !== "writing") return clearInterval(iv);
      if (!dirty) return; dirty = false;
      try { await store.update(`sessions/${sid}/pieces/${me}`, { text: ta.value, updatedAt: store.now() }); } catch (e) { dirty = true; }
    }, 4000);
    setTimeout(() => ta.focus(), 50);
    $("#submit").onclick = async () => {
      if (!viewCtx.canSubmit()) return;
      if (!confirm("Submit your moment? You won't be able to change it after this.")) return;
      busy = true; tick();
      try {
        await store.tx(async (t) => {
          const now = store.now();
          t.update(`sessions/${sid}/pieces/${me}`, { text: ta.value.trim(), submitted: true, submittedAt: now, status: "pool", pooledAt: now, readers: [], reader: null });
          t.update(`sessions/${sid}/people/${me}`, { phase: "waiting", waitingSince: now });
        });
      } catch (e) { console.error(e); alert("Couldn't submit — please try again."); }
      busy = false;
    };
  },

  waiting() {
    main.className = "";
    setBar(`<div class="brand">I Want to Feel More Alive</div><div class="status">Waiting</div><span></span>`);
    const first = !person || !person.readsDone;
    main.innerHTML = `<div class="center-card">
      <div class="wait-dots"><span></span><span></span><span></span></div>
      <h2>${first ? "Thank you. Your moment is on its way to a reader." : "Thank you. You've passed it on."}</h2>
      <p>${first ? "As soon as someone else submits, their moment will appear here for you to read." : "As soon as another reader finishes, a new moment will appear here — one you haven't read yet."}</p>
      <p class="muted">Take a breath. Stay on this page.</p></div>`;
  },

  reading(pid) {
    main.className = "reading";
    setBar(`<div class="brand">I Want to Feel More Alive</div><div id="status" class="status"></div><button id="submit" class="btn primary" disabled>Pass it on →</button>`);
    main.innerHTML = `
      <div id="banner" class="banner"></div>
      <div class="instructions" id="instr"></div>
      <div id="vp"></div>
      <div class="legend" id="legend"></div>`;
    const ctx = viewCtx; ctx.pid = pid; ctx.notes = []; ctx.paper = null;
    const setup = (piece) => {
      if (!piece || ctx.paper) return;
      const mySlot = Math.max(1, (piece.readers || []).indexOf(me) + 1);
      ctx.mySlot = mySlot;
      const earlier = [1, 2, 3].filter((s) => s < mySlot);
      const cname = { 1: "blue", 2: "red", 3: "green" };
      const earlierTxt = earlier.map((s) => `<span style="color:${SLOT_COLORS[s]}">${cname[s]}</span>`).join(" and ");
      $("#instr").innerHTML = `
        <b>Read through your collaborator's moment.</b> Highlight a phrase or sentence, then click <span class="chip">+ Add reflection</span> to leave a reflection beside it.
        In each reflection, <b>connect what they wrote to an experience of your own.</b> Do this for as many phrases as you can.
        ${earlier.length ? `<br>The ${earlierTxt} notes are from earlier readers — you can also <b>reply</b> to their reflections.` : ""}
        <span class="hint">Drag the paper to move around it.</span>`;
      wireInstr();
      $("#legend").innerHTML = `<span><i style="background:#222"></i>Writer</span>` +
        earlier.map((s) => `<span><i style="background:${SLOT_COLORS[s]}"></i>${SLOT_NAMES[s]}</span>`).join("") +
        `<span><i style="background:${SLOT_COLORS[mySlot]}"></i>You</span>`;
      // Leave our first name for the author to see at the very end.
      if (myPrivate && myPrivate.firstName) store.set(`sessions/${sid}/pieces/${pid}/names/${me}`, { firstName: myPrivate.firstName, slot: mySlot }).catch(console.error);
      else store.get(`sessions/${sid}/private/${me}`).then((p) => { myPrivate = p; if (p) store.set(`sessions/${sid}/pieces/${pid}/names/${me}`, { firstName: p.firstName, slot: mySlot }); }).catch(console.error);
      ctx.paper = createPaper($("#vp"), {
        text: piece.text, mode: "edit", me, mySlot, heading: "Your collaborator's moment",
        labelFor: (slot, by) => by === me ? "You" : (SLOT_NAMES[slot] || "Reader"),
        onAdd: async (d) => {
          await store.add(`sessions/${sid}/pieces/${pid}/notes`, { ...d, by: me, slot: mySlot, parent: null, at: store.now() });
          if (!piece.touched) store.update(`sessions/${sid}/pieces/${pid}`, { touched: true }).catch(() => {});
        },
        onReply: async (parentId, body) => {
          await store.add(`sessions/${sid}/pieces/${pid}/notes`, { body, by: me, slot: mySlot, parent: parentId, at: store.now() });
          if (!piece.touched) store.update(`sessions/${sid}/pieces/${pid}`, { touched: true }).catch(() => {});
        },
        onEdit: (id, body) => store.update(`sessions/${sid}/pieces/${pid}/notes/${id}`, { body, editedAt: store.now() }),
        onMove: (id, x, y) => store.update(`sessions/${sid}/pieces/${pid}/notes/${id}`, { x, y }).catch(console.error),
        onDelete: (id) => {
          const kids = ctx.notes.filter((n) => n.parent === id);
          return Promise.all([...kids.map((n) => store.del(`sessions/${sid}/pieces/${pid}/notes/${n.id}`)), store.del(`sessions/${sid}/pieces/${pid}/notes/${id}`)]);
        },
      });
      ctx.paper.setNotes(ctx.notes);
    };
    const u1 = store.watchDoc(`sessions/${sid}/pieces/${pid}`, (p) => { ctx.piece = p; setup(p); });
    const u2 = store.watchColl(`sessions/${sid}/pieces/${pid}/notes`, (ns) => { ctx.notes = ns; if (ctx.paper) ctx.paper.setNotes(ns); tick(); });
    unsubsView(u1, u2);
    ctx.canSubmit = () => true;
    $("#submit").onclick = async () => {
      const mineCount = ctx.notes.filter((n) => n.by === me).length;
      const msg = mineCount === 0 ? "You haven't left any reflections yet. Pass it on anyway?" : `Pass this moment on with your ${mineCount} reflection${mineCount === 1 ? "" : "s"}? You won't be able to come back to it.`;
      if (!confirm(msg)) return;
      busy = true; tick();
      try { await finishReading(pid); } catch (e) { console.error(e); alert("Couldn't pass it on — please try again."); }
      busy = false;
    };
  },

  returnwait() {
    main.className = "";
    setBar(`<div class="brand">I Want to Feel More Alive</div><div class="status">Almost there</div><span></span>`);
    main.innerHTML = `<div class="center-card">
      <div class="wait-dots"><span></span><span></span><span></span></div>
      <h2>Thank you for reading so generously.</h2>
      <p>Your own moment is on its way back to you. It will appear here, with everyone's reflections, as soon as your last reader finishes.</p></div>`;
  },

  return() {
    main.className = "reading";
    setBar(`<div class="brand">I Want to Feel More Alive</div><div class="status open">Your moment, as others read it</div><span></span>`);
    main.innerHTML = `<div class="instructions" id="instr"><b>Here is your moment, as other people read it.</b> Take your time with their reflections — notice what they saw, and what it brought up for them. <span class="hint">Drag the paper to move around it.</span></div><div id="vp"></div><div class="legend" id="legend"></div>`;
    wireInstr();
    const ctx = viewCtx; ctx.names = {}; ctx.notes = [];
    const label = (slot) => { const n = Object.values(ctx.names).find((x) => x.slot === slot); return n ? n.firstName : (SLOT_NAMES[slot] || "Reader"); };
    const mine = pieces.find((p) => p.id === me);
    ctx.paper = createPaper($("#vp"), { text: (mine && mine.text) || "", mode: "view", me, mySlot: 0, heading: "Your moment", labelFor: (slot) => label(slot) });
    const legend = () => {
      const slots = [...new Set(ctx.notes.map((n) => n.slot))].sort();
      $("#legend").innerHTML = `<span><i style="background:#222"></i>You</span>` + slots.map((s) => `<span><i style="background:${SLOT_COLORS[s]}"></i>${esc(label(s))}</span>`).join("");
    };
    unsubsView(
      store.watchColl(`sessions/${sid}/pieces/${me}/notes`, (ns) => { ctx.notes = ns; ctx.paper.setNotes(ns); legend(); }),
      store.watchColl(`sessions/${sid}/pieces/${me}/names`, (ns) => { ctx.names = Object.fromEntries(ns.map((n) => [n.id, n])); ctx.paper.setNotes(ctx.notes); legend(); }),
    );
  },
};

function wireInstr() {
  const box = $("#instr"); if (!box) return;
  const b = document.createElement("button"); b.className = "hide"; b.textContent = "Hide";
  box.prepend(b);
  const set = (c) => { box.classList.toggle("collapsed", c); b.textContent = c ? "Show instructions" : "Hide"; };
  b.onclick = (e) => { e.stopPropagation(); set(!box.classList.contains("collapsed")); };
  box.onclick = () => { if (box.classList.contains("collapsed")) set(false); };
}
function unsubsView(...us) { viewUnsubs.forEach((u) => u()); viewUnsubs = us; }

// ---------------- matching ----------------
async function finishReading(pid) {
  await store.tx(async (t) => {
    const p = await t.get(`sessions/${sid}/pieces/${pid}`);
    const me_ = await t.get(`sessions/${sid}/people/${me}`);
    if (!p || !me_ || me_.holding !== pid) return;
    const now = store.now();
    const done = (me_.readsDone || 0) + 1;
    t.update(`sessions/${sid}/pieces/${pid}`, { reader: null, status: (p.readers || []).length >= ROUNDS ? "complete" : "pool", pooledAt: now, touched: false });
    t.update(`sessions/${sid}/people/${me}`, { readsDone: done, holding: null, phase: done >= ROUNDS ? "done" : "waiting", waitingSince: now });
  });
}

function eligibleFor(uid, p) {
  return p.status === "pool" && p.submitted && p.author !== uid && !(p.readers || []).includes(uid) && (p.readers || []).length < ROUNDS;
}
let matching = false;
async function matchmake() {
  if (matching || !person || person.phase !== "waiting" || !sid) return;
  const cands = pieces.filter((p) => eligibleFor(me, p))
    .sort((a, b) => ((b.readers || []).length - (a.readers || []).length) || ((a.pooledAt || 0) - (b.pooledAt || 0)));
  if (!cands.length) return;
  matching = true;
  try {
    for (const c of cands) {
      const ok = await store.tx(async (t) => {
        const p = await t.get(`sessions/${sid}/pieces/${c.id}`);
        const pr = await t.get(`sessions/${sid}/people/${me}`);
        if (!p || !pr || pr.phase !== "waiting") return false;
        if (!eligibleFor(me, { ...p, id: c.id })) return false;
        const now = store.now();
        t.update(`sessions/${sid}/pieces/${c.id}`, { status: "reading", reader: me, readers: [...(p.readers || []), me], claimedAt: now, touched: false });
        t.update(`sessions/${sid}/people/${me}`, { phase: "reading", holding: c.id, claimedAt: now });
        return true;
      }).catch((e) => { console.warn("claim failed", e); return false; });
      if (ok) break;
    }
  } finally { matching = false; }
}

// If someone has waited a while and nothing they can read is in the pool, swap into a
// just-started, untouched reading: they take that piece, and its reader gets one from the pool.
let lastRescue = 0;
async function matchmakeTimer() {
  if (!person || person.phase !== "waiting" || !session) return;
  const now = store.now();
  const e = elapsedMin(session, now);
  const sch = schedule(session);
  // Escape hatch: later-round waiters who can never be matched.
  if ((person.readsDone || 0) >= 1 && (session.endReading || (e != null && e >= sch[ROUND_KEYS[ROUNDS - 1]].target + 2))) {
    await store.update(`sessions/${sid}/people/${me}`, { phase: "done", waitingSince: now }).catch(() => {});
    return;
  }
  matchmake();
  const waited = (now - (person.waitingSince || now)) / 1000;
  if (waited < 20 || now - lastRescue < 6000 || matching) return;
  if (pieces.some((p) => eligibleFor(me, p))) return;
  lastRescue = now;
  const busyOnes = pieces.filter((p) => p.status === "reading" && p.reader && p.reader !== me && !p.touched && now - (p.claimedAt || 0) < 150000
    && p.author !== me && !(p.readers || []).filter((r) => r !== p.reader).includes(me));
  for (const P of busyOnes) {
    const R = P.reader;
    const Q = pieces.find((q) => q.id !== P.id && eligibleFor(R, q));
    if (!Q) continue;
    matching = true;
    const ok = await store.tx(async (t) => {
      const p = await t.get(`sessions/${sid}/pieces/${P.id}`);
      const q = await t.get(`sessions/${sid}/pieces/${Q.id}`);
      const rp = await t.get(`sessions/${sid}/people/${R}`);
      const mp = await t.get(`sessions/${sid}/people/${me}`);
      if (!p || !q || !rp || !mp) return false;
      if (mp.phase !== "waiting" || p.status !== "reading" || p.reader !== R || p.touched || rp.holding !== P.id) return false;
      if (!eligibleFor(R, { ...q, id: Q.id })) return false;
      const t0 = store.now();
      const pReaders = (p.readers || []).filter((x) => x !== R);
      if (p.author === me || pReaders.includes(me)) return false;
      t.update(`sessions/${sid}/pieces/${P.id}`, { reader: me, readers: [...pReaders, me], claimedAt: t0, touched: false });
      t.update(`sessions/${sid}/pieces/${Q.id}`, { status: "reading", reader: R, readers: [...(q.readers || []), R], claimedAt: t0, touched: false });
      t.update(`sessions/${sid}/people/${R}`, { holding: Q.id, claimedAt: t0, swapped: t0 });
      t.update(`sessions/${sid}/people/${me}`, { phase: "reading", holding: P.id, claimedAt: t0 });
      return true;
    }).catch((err) => { console.warn("rescue failed", err); return false; });
    matching = false;
    if (ok) break;
  }
}

// Let a reader know if their piece was quietly swapped before they started.
let lastSwap = null;
setInterval(() => {
  if (person && person.swapped && person.swapped !== lastSwap) {
    if (lastSwap !== null) toast("You've been given a different moment to read — the timing worked out better this way.");
    lastSwap = person.swapped;
  } else if (person && lastSwap === null) lastSwap = person.swapped || 0;
}, 800);

boot();
