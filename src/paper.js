// The "giant sheet of paper": writing in the middle, highlights, reflection cards, hand-drawn arrows.
const PAPER_W = 2400;
const DOC_W = 640;
const DOC_X = (PAPER_W - DOC_W) / 2;
const DOC_Y = 170;
const CARD_W = 300;
const GAP = 80;

export const SLOT_COLORS = { 1: "#2c5fae", 2: "#b8432a" };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/**
 * opts: {
 *   text, mode: 'edit' | 'view', mySlot, labelFor(slot) -> string, heading,
 *   onAdd({start,end,quote,body,x,y}), onReply(parentId, body), onMove(id,x,y), onDelete(id),
 *   me (uid), instructionsEl
 * }
 */
export function createPaper(viewport, opts) {
  viewport.innerHTML = "";
  viewport.classList.add("viewport");
  const paper = el("div", "paper");
  paper.style.width = PAPER_W + "px";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("arrows");
  const heading = el("div", "paper-heading", opts.heading || "A moment, most alive");
  heading.style.left = DOC_X + "px"; heading.style.width = DOC_W + "px"; heading.style.top = (DOC_Y - 80) + "px";
  const docEl = el("div", "doc");
  docEl.style.left = DOC_X + "px"; docEl.style.top = DOC_Y + "px"; docEl.style.width = DOC_W + "px";
  const cardsLayer = el("div", "cards");
  const addBtn = el("button", "add-btn", "+ Add reflection");
  addBtn.style.display = "none";
  paper.append(svg, heading, docEl, cardsLayer, addBtn);
  viewport.append(paper);

  const text = opts.text || "";
  let notes = [];
  let draft = null; // {start,end,quote,el}
  let openReply = null; // {id, value}
  let pan = { x: 0, y: 0 };
  let pendingSel = null;

  // ---------- panning ----------
  function applyPan() { paper.style.transform = `translate(${pan.x}px, ${pan.y}px)`; }
  function clampPan() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const ph = paper.offsetHeight;
    pan.x = Math.min(200, Math.max(vw - PAPER_W - 200, pan.x));
    pan.y = Math.min(200, Math.max(Math.min(0, vh - ph - 200), pan.y));
  }
  function centerOnDoc() {
    const vw = viewport.clientWidth;
    pan.x = Math.round(vw / 2 - (DOC_X + DOC_W / 2));
    pan.y = Math.round(150 - (DOC_Y - 80));
    clampPan(); applyPan();
  }
  let panning = null;
  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".card, .doc, .add-btn, textarea, button")) return;
    panning = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, id: e.pointerId };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add("grabbing");
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!panning || e.pointerId !== panning.id) return;
    pan.x = panning.px + e.clientX - panning.sx; pan.y = panning.py + e.clientY - panning.sy;
    clampPan(); applyPan();
  });
  const endPan = () => { panning = null; viewport.classList.remove("grabbing"); };
  viewport.addEventListener("pointerup", endPan);
  viewport.addEventListener("pointercancel", endPan);
  viewport.addEventListener("wheel", (e) => {
    if (e.target.closest("textarea")) return;
    e.preventDefault();
    pan.x -= e.deltaX; pan.y -= e.deltaY; clampPan(); applyPan();
  }, { passive: false });

  // ---------- geometry ----------
  function relRect(r) {
    const p = paper.getBoundingClientRect();
    return { left: r.left - p.left, top: r.top - p.top, right: r.right - p.left, bottom: r.bottom - p.top, width: r.width, height: r.height };
  }
  function noteRects(id) {
    const spans = docEl.querySelectorAll(`[data-n~="${id}"]`);
    const rects = [];
    spans.forEach((s) => { for (const r of s.getClientRects()) rects.push(relRect(r)); });
    return rects;
  }
  function rangeRects(start, end) {
    const rects = [];
    docEl.querySelectorAll("span[data-off]").forEach((s) => {
      const a = +s.dataset.off, b = a + s.textContent.length;
      if (b <= start || a >= end) return;
      const tn = s.firstChild; if (!tn) return;
      const r = document.createRange();
      r.setStart(tn, Math.max(0, start - a)); r.setEnd(tn, Math.min(tn.length, end - a));
      for (const cr of r.getClientRects()) rects.push(relRect(cr));
    });
    return rects;
  }

  // ---------- text + highlights ----------
  function renderDoc() {
    const tops = notes.filter((n) => !n.parent && n.end > n.start);
    const cuts = new Set([0, text.length]);
    tops.forEach((n) => { cuts.add(Math.max(0, Math.min(text.length, n.start))); cuts.add(Math.max(0, Math.min(text.length, n.end))); });
    if (draft) { cuts.add(draft.start); cuts.add(draft.end); }
    const pts = [...cuts].sort((a, b) => a - b);
    docEl.innerHTML = "";
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (b <= a) continue;
      const span = el("span", null, text.slice(a, b));
      span.dataset.off = a;
      const cover = tops.filter((n) => n.start <= a && n.end >= b);
      if (cover.length) {
        span.dataset.n = cover.map((n) => n.id).join(" ");
        const slots = [...new Set(cover.map((n) => n.slot))].sort();
        span.classList.add("hl", "hl" + slots.join(""));
      }
      if (draft && draft.start <= a && draft.end >= b) span.classList.add("hl-draft");
      docEl.append(span);
    }
  }

  // ---------- cards ----------
  function canEdit(n) { return opts.mode === "edit" && n.by === opts.me; }
  function cardFor(n, replies) {
    const c = el("div", `card s${n.slot}` + (canEdit(n) ? " mine" : ""));
    c.dataset.id = n.id;
    c.style.left = n.x + "px"; c.style.top = n.y + "px"; c.style.width = CARD_W + "px";
    const h = el("div", "card-h");
    h.append(el("span", "who", opts.labelFor(n.slot, n.by)));
    if (canEdit(n)) {
      const del = el("button", "x", "×"); del.title = "Delete this reflection";
      del.onclick = () => { if (confirm("Delete this reflection?")) opts.onDelete(n.id); };
      h.append(del);
      h.classList.add("drag");
    }
    c.append(h);
    if (n.quote) c.append(el("div", "q", "“" + (n.quote.length > 140 ? n.quote.slice(0, 137) + "…" : n.quote) + "”"));
    c.append(el("div", "body", n.body));
    if (replies.length) {
      const rs = el("div", "replies");
      for (const r of replies) {
        const rr = el("div", `reply s${r.slot}`);
        const rh = el("div", "reply-h");
        rh.append(el("span", "who", "↳ " + opts.labelFor(r.slot, r.by)));
        if (canEdit(r)) {
          const del = el("button", "x", "×"); del.title = "Delete this reply";
          del.onclick = () => { if (confirm("Delete this reply?")) opts.onDelete(r.id); };
          rh.append(del);
        }
        rr.append(rh, el("div", "body", r.body));
        rs.append(rr);
      }
      c.append(rs);
    }
    if (opts.mode === "edit") {
      if (openReply && openReply.id === n.id) {
        const f = el("div", "reply-form");
        const ta = el("textarea"); ta.rows = 3; ta.placeholder = "Reply — and connect it to your own experience…"; ta.value = openReply.value || "";
        ta.oninput = () => { openReply.value = ta.value; };
        const row = el("div", "row");
        const save = el("button", "btn small primary", "Add reply");
        const cancel = el("button", "btn small", "Cancel");
        save.onclick = async () => {
          const v = ta.value.trim(); if (!v) return;
          save.disabled = true; openReply = null;
          await opts.onReply(n.id, v);
        };
        cancel.onclick = () => { openReply = null; renderCards(); };
        row.append(cancel, save); f.append(ta, row); c.append(f);
        setTimeout(() => ta.focus(), 0);
      } else {
        const rb = el("button", "reply-btn", "Reply");
        rb.onclick = () => { openReply = { id: n.id, value: "" }; renderCards(); };
        c.append(rb);
      }
    }
    if (canEdit(n)) makeDraggable(c, h, n);
    return c;
  }
  function makeDraggable(card, handle, n) {
    let st = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      st = { sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, id: e.pointerId };
      handle.setPointerCapture(e.pointerId); card.classList.add("dragging"); e.stopPropagation();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!st) return;
      n.x = Math.round(st.x + e.clientX - st.sx); n.y = Math.max(20, Math.round(st.y + e.clientY - st.sy));
      card.style.left = n.x + "px"; card.style.top = n.y + "px"; drawArrows();
    });
    const end = () => { if (!st) return; st = null; card.classList.remove("dragging"); opts.onMove(n.id, n.x, n.y); fitHeight(); };
    handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
  }
  function renderCards() {
    cardsLayer.innerHTML = "";
    const tops = notes.filter((n) => !n.parent);
    for (const n of tops) {
      const replies = notes.filter((r) => r.parent === n.id).sort((a, b) => (a.at || 0) - (b.at || 0));
      cardsLayer.append(cardFor(n, replies));
    }
    if (draft) cardsLayer.append(draft.el);
    relax();
    drawArrows(); fitHeight();
  }
  // Nudge cards down so none sit on top of each other (display only; saved positions unchanged).
  function relax() {
    const cs = [...cardsLayer.querySelectorAll(".card")].filter((c) => !c.classList.contains("dragging"));
    cs.forEach((c) => { c.style.top = (c._baseTop ?? c.offsetTop) + "px"; });
    cs.sort((a, b) => a.offsetTop - b.offsetTop);
    const placed = [];
    for (const c of cs) {
      let y = c.offsetTop; const x = c.offsetLeft, w = c.offsetWidth, h = c.offsetHeight;
      let moved = true;
      while (moved) {
        moved = false;
        for (const p of placed) {
          if (x < p.x + p.w - 20 && x + w > p.x + 20 && y < p.y + p.h + 12 && y + h > p.y) { y = p.y + p.h + 14; moved = true; }
        }
      }
      c.style.top = y + "px";
      placed.push({ x, y, w, h });
    }
  }
  function fitHeight() {
    let maxB = DOC_Y + docEl.offsetHeight + 400;
    cardsLayer.querySelectorAll(".card").forEach((c) => { maxB = Math.max(maxB, c.offsetTop + c.offsetHeight + 300); });
    paper.style.height = Math.max(1600, maxB) + "px";
    svg.setAttribute("width", PAPER_W); svg.setAttribute("height", paper.style.height.replace("px", ""));
  }

  // ---------- arrows ----------
  function arrowPath(S, E, seed, color, dir) {
    const R = rng(seed);
    const w = () => (R() - 0.5) * 8;
    // Leave the card horizontally, then ride the gap just above the highlighted line.
    const c1 = { x: S.x + dir * -60 + w(), y: S.y + w() };
    const c2 = { x: E.x + dir * 55 + w(), y: E.y - 11 + w() * 0.3 };
    const d = `M${S.x.toFixed(1)},${S.y.toFixed(1)} C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${E.x.toFixed(1)},${E.y.toFixed(1)}`;
    const ang = Math.atan2(E.y - c2.y, E.x - c2.x);
    const L = 13, A = 0.45;
    const h1 = { x: E.x - L * Math.cos(ang - A), y: E.y - L * Math.sin(ang - A) };
    const h2 = { x: E.x - L * Math.cos(ang + A), y: E.y - L * Math.sin(ang + A) };
    const head = `M${h1.x.toFixed(1)},${h1.y.toFixed(1)} L${E.x.toFixed(1)},${E.y.toFixed(1)} L${h2.x.toFixed(1)},${h2.y.toFixed(1)}`;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    for (const [dd, sw, op, off] of [[d, 2.1, 0.85, 0], [d, 1.1, 0.35, 1.2], [head, 2.1, 0.85, 0]]) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", dd); p.setAttribute("fill", "none"); p.setAttribute("stroke", color);
      p.setAttribute("stroke-width", sw); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
      p.setAttribute("opacity", op); if (off) p.setAttribute("transform", `translate(${off},${off * 0.6})`);
      g.append(p);
    }
    return g;
  }
  function connect(cardEl, rects, color, seed) {
    if (!rects.length || !cardEl) return;
    const cx = cardEl.offsetLeft, cy = cardEl.offsetTop, cw = cardEl.offsetWidth;
    const r = rects[0];
    const cardRight = cx > r.right - 10 || cx + cw / 2 > DOC_X + DOC_W / 2;
    const S = cardRight ? { x: cx - 4, y: cy + 26 } : { x: cx + cw + 4, y: cy + 26 };
    const target = cardRight ? rects.reduce((a, b) => (b.top < a.top + 2 && b.right > a.right ? b : a), r) : r;
    const inset = Math.min(14, target.width / 3);
    const E = cardRight ? { x: target.right - inset, y: target.top + 3 } : { x: target.left + inset, y: target.top + 3 };
    svg.append(arrowPath(S, E, seed, color, cardRight ? 1 : -1));
  }
  function drawArrows() {
    svg.innerHTML = "";
    for (const n of notes.filter((x) => !x.parent)) {
      const cardEl = cardsLayer.querySelector(`.card[data-id="${n.id}"]`);
      connect(cardEl, noteRects(n.id), SLOT_COLORS[n.slot] || "#555", hash(n.id));
    }
    if (draft) connect(draft.el, rangeRects(draft.start, draft.end), SLOT_COLORS[opts.mySlot] || "#555", 7);
  }

  // ---------- placement ----------
  function placeFor(rects) {
    const top = rects.length ? rects[0].top - 14 : DOC_Y;
    const cx = rects.length ? (rects[0].left + rects[0].right) / 2 : DOC_X + DOC_W;
    const nearRight = cx >= DOC_X + DOC_W / 2;
    const sides = [
      { x: DOC_X + DOC_W + GAP, name: "r" },
      { x: DOC_X - GAP - CARD_W, name: "l" },
    ];
    const existing = [...cardsLayer.querySelectorAll(".card")].map((c) => ({ x: c.offsetLeft, y: c.offsetTop, h: c.offsetHeight }));
    let best = null;
    for (const s of sides) {
      let y = Math.max(40, top);
      const col = existing.filter((c) => Math.abs(c.x - s.x) < CARD_W).sort((a, b) => a.y - b.y);
      for (const c of col) { if (y < c.y + c.h + 18 && y + 170 > c.y) y = c.y + c.h + 18; }
      const cost = y - top + ((s.name === "r") === nearRight ? 0 : 160);
      if (!best || cost < best.cost - 40) best = { x: s.x, y, cost };
    }
    return { x: best.x, y: best.y };
  }

  // ---------- selection → draft ----------
  function selOffsets() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    if (!docEl.contains(r.startContainer) || !docEl.contains(r.endContainer)) return null;
    const pre = document.createRange();
    pre.setStart(docEl, 0);
    pre.setEnd(r.startContainer, r.startOffset);
    let start = pre.toString().length;
    let end = start + r.toString().length;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    while (start > 0 && /[\p{L}\p{N}'’]/u.test(text[start - 1])) start--;
    while (end < text.length && /[\p{L}\p{N}'’]/u.test(text[end])) end++;
    if (end - start < 2) return null;
    const last = r.getClientRects(); const lr = last[last.length - 1];
    return { start, end, quote: text.slice(start, end), at: lr ? relRect(lr) : null };
  }
  if (opts.mode === "edit") {
    const check = () => setTimeout(() => {
      const s = selOffsets();
      if (!s || draft) { addBtn.style.display = "none"; pendingSel = null; return; }
      pendingSel = s;
      addBtn.style.display = "block";
      addBtn.style.left = (s.at ? s.at.right + 8 : DOC_X + DOC_W) + "px";
      addBtn.style.top = (s.at ? s.at.bottom + 6 : DOC_Y) + "px";
    }, 10);
    docEl.addEventListener("mouseup", check);
    docEl.addEventListener("keyup", check);
    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { if (!addBtn.matches(":hover")) { addBtn.style.display = "none"; } }
    });
    addBtn.addEventListener("pointerdown", (e) => e.preventDefault());
    addBtn.addEventListener("click", () => {
      if (!pendingSel) return;
      startDraft(pendingSel);
      addBtn.style.display = "none";
      window.getSelection().removeAllRanges();
    });
  }
  function startDraft(s) {
    const c = el("div", `card draft s${opts.mySlot}`);
    c.style.width = CARD_W + "px";
    const h = el("div", "card-h"); h.append(el("span", "who", opts.labelFor(opts.mySlot, opts.me)));
    const q = el("div", "q", "“" + (s.quote.length > 140 ? s.quote.slice(0, 137) + "…" : s.quote) + "”");
    const ta = el("textarea"); ta.rows = 5;
    ta.placeholder = "What does this bring up for you? Connect it to a moment or experience of your own…";
    const row = el("div", "row");
    const cancel = el("button", "btn small", "Cancel");
    const save = el("button", "btn small primary", "Add to the page");
    row.append(cancel, save);
    c.append(h, q, ta, row);
    draft = { ...s, el: c };
    renderDoc();
    const pos = placeFor(rangeRects(s.start, s.end));
    c.style.left = pos.x + "px"; c.style.top = pos.y + "px";
    renderCards();
    setTimeout(() => ta.focus(), 0);
    cancel.onclick = () => { draft = null; renderDoc(); renderCards(); };
    save.onclick = async () => {
      const body = ta.value.trim(); if (!body) { ta.focus(); return; }
      save.disabled = true;
      const d = { start: s.start, end: s.end, quote: s.quote, body, x: c.offsetLeft, y: c.offsetTop };
      draft = null;
      await opts.onAdd(d);
    };
  }

  // ---------- api ----------
  const api = {
    paper, docEl,
    setNotes(list) {
      notes = list.map((n) => ({ ...n }));
      renderDoc(); renderCards();
    },
    centerOnDoc,
    refresh() { renderDoc(); renderCards(); },
    bounds() {
      let x0 = DOC_X - 40, y0 = DOC_Y - 110, x1 = DOC_X + DOC_W + 40, y1 = DOC_Y + docEl.offsetHeight + 60;
      cardsLayer.querySelectorAll(".card").forEach((c) => {
        x0 = Math.min(x0, c.offsetLeft - 40); y0 = Math.min(y0, c.offsetTop - 40);
        x1 = Math.max(x1, c.offsetLeft + c.offsetWidth + 40); y1 = Math.max(y1, c.offsetTop + c.offsetHeight + 40);
      });
      return { x: Math.max(0, x0), y: Math.max(0, y0), w: x1 - Math.max(0, x0), h: y1 - Math.max(0, y0) };
    },
  };
  renderDoc(); renderCards();
  requestAnimationFrame(centerOnDoc);
  window.addEventListener("resize", () => { clampPan(); applyPan(); });
  if (document.fonts) document.fonts.ready.then(() => { drawArrows(); });
  return api;
}
