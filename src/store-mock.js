// In-memory stand-in for Firestore, shared across same-origin iframes via window.top.
// Used only for local testing (?mock=1).
function shared() {
  const top = window.top;
  if (!top.__mockDB) {
    top.__mockDB = { docs: new Map(), listeners: new Set(), lock: Promise.resolve(), offset: 0, seq: 0 };
  }
  return top.__mockDB;
}
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const parent = (p) => p.split("/").slice(0, -1).join("/");

export function createMockStore() {
  const S = shared();
  const params = new URLSearchParams(location.search);
  function notify(path) {
    for (const l of S.listeners) {
      if (l.type === "doc" && l.path === path) l.fire();
      if (l.type === "coll" && parent(path) === l.path) l.fire();
    }
  }
  function write(p, data, merge) {
    const prev = S.docs.get(p);
    S.docs.set(p, merge && prev ? { ...prev, ...clone(data) } : clone(data));
    notify(p);
  }
  function addListener(l) {
    S.listeners.add(l);
    // Remove listener when this frame goes away.
    window.addEventListener("unload", () => S.listeners.delete(l));
    setTimeout(l.fire, 0);
    return () => S.listeners.delete(l);
  }
  const store = {
    kind: "mock",
    uid: null,
    email: null,
    now: () => Date.now() + (window.top.__mockDB.offset || 0),
    async initAnon() { store.uid = params.get("uid") || "u" + Math.random().toString(36).slice(2, 8); return store.uid; },
    async initHost() { store.uid = "host"; store.email = "pbnilsson@gmail.com"; return store.email; },
    async signOut() {},
    async get(p) { return clone(S.docs.get(p) ?? null); },
    async set(p, data, merge = false) { write(p, data, merge); },
    async update(p, patch) {
      if (!S.docs.has(p)) throw new Error("No document to update: " + p);
      write(p, patch, true);
    },
    async add(p, data) { const id = "n" + (++S.seq).toString(36) + Math.random().toString(36).slice(2, 6); write(`${p}/${id}`, data, false); return id; },
    async del(p) { S.docs.delete(p); notify(p); },
    watchDoc(p, cb) {
      const l = { type: "doc", path: p, fire: () => { try { cb(clone(S.docs.get(p) ?? null)); } catch (e) { console.error(e); } } };
      return addListener(l);
    },
    watchColl(p, cb) {
      const l = {
        type: "coll", path: p, fire: () => {
          const out = [];
          for (const [k, v] of S.docs) if (parent(k) === p) out.push({ id: k.split("/").pop(), ...clone(v) });
          try { cb(out); } catch (e) { console.error(e); }
        },
      };
      return addListener(l);
    },
    async tx(fn) {
      let release;
      const prev = S.lock;
      S.lock = new Promise((r) => (release = r));
      await prev;
      try {
        const writes = [];
        const res = await fn({
          get: async (p) => clone(S.docs.get(p) ?? null),
          set: (p, d, m = false) => writes.push(() => write(p, d, m)),
          update: (p, d) => writes.push(() => write(p, d, true)),
        });
        writes.forEach((w) => w());
        return res;
      } finally { release(); }
    },
  };
  return store;
}
