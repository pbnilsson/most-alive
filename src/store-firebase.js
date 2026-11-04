import { initializeApp } from "firebase/app";
import {
  getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut,
} from "firebase/auth";
import {
  getFirestore, doc, collection, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  onSnapshot, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { firebaseConfig } from "./config.js";

export function createFirebaseStore() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let offset = 0;
  const d = (p) => doc(db, p);
  const c = (p) => collection(db, p);

  const store = {
    kind: "firebase",
    uid: null,
    email: null,
    now: () => Date.now() + offset,

    async initAnon() {
      await new Promise((res) => {
        const un = onAuthStateChanged(auth, async (u) => {
          if (u) { un(); store.uid = u.uid; store.email = u.email; res(); }
          else { await signInAnonymously(auth); }
        });
      });
      await store.calibrate();
      return store.uid;
    },
    async currentUser() {
      return new Promise((res) => {
        const un = onAuthStateChanged(auth, (u) => { un(); res(u); });
      });
    },
    async initHost(interactive) {
      let u = await store.currentUser();
      if ((!u || u.isAnonymous) && interactive) {
        const r = await signInWithPopup(auth, new GoogleAuthProvider());
        u = r.user;
      }
      if (!u || u.isAnonymous) return null;
      store.uid = u.uid; store.email = u.email;
      await store.calibrate();
      return u.email;
    },
    async signOut() { await signOut(auth); },
    async calibrate() {
      try {
        const t0 = Date.now();
        await setDoc(d(`clocks/${store.uid}`), { t: serverTimestamp() });
        const snap = await getDoc(d(`clocks/${store.uid}`));
        const t1 = Date.now();
        const server = snap.data().t.toMillis();
        offset = server - (t0 + t1) / 2;
      } catch (e) { console.warn("clock calibration failed", e); offset = 0; }
    },

    async get(p) { const s = await getDoc(d(p)); return s.exists() ? s.data() : null; },
    async set(p, data, merge = false) { await setDoc(d(p), data, { merge }); },
    async update(p, patch) { await updateDoc(d(p), patch); },
    async add(p, data) { const r = await addDoc(c(p), data); return r.id; },
    async del(p) { await deleteDoc(d(p)); },
    watchDoc(p, cb, onErr) {
      return onSnapshot(d(p), (s) => cb(s.exists() ? s.data() : null), (e) => { console.error(p, e); onErr && onErr(e); });
    },
    watchColl(p, cb, onErr) {
      return onSnapshot(c(p), (s) => cb(s.docs.map((x) => ({ id: x.id, ...x.data() }))), (e) => { console.error(p, e); onErr && onErr(e); });
    },
    async tx(fn) {
      return runTransaction(db, async (t) => fn({
        get: async (p) => { const s = await t.get(d(p)); return s.exists() ? s.data() : null; },
        set: (p, data, merge = false) => t.set(d(p), data, { merge }),
        update: (p, patch) => t.update(d(p), patch),
      }));
    },
  };
  return store;
}
