// Firebase web config — paste the block from Firebase console here.
export const firebaseConfig = {
  apiKey: "AIzaSyBmOt4a3DfyFmArn1hKeHlV9ORUDKG4Q4U",
  authDomain: "most-alive-89fc9.firebaseapp.com",
  projectId: "most-alive-89fc9",
  storageBucket: "most-alive-89fc9.firebasestorage.app",
  messagingSenderId: "476795257827",
  appId: "1:476795257827:web:e652f33e7b5235a43996d6",
};

export const HOST_EMAIL = "pbnilsson@gmail.com";

// Minutes from the moment the host clicks Start.
export const DEFAULT_SCHEDULE = {
  doors: 7,
  write: { unlock: 7, warn: 8, target: 9 },
  r1: { unlock: 14, warn: 14, target: 15 },
  r2: { unlock: 20, warn: 20, target: 21 },
  r3: { unlock: 26, warn: 26, target: 27 },
  end: 29,
};
