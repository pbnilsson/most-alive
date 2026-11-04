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
  doors: 8,
  write: { unlock: 8, warn: 9, target: 10 },
  r1: { unlock: 16, warn: 17, target: 18 },
  r2: { unlock: 24, warn: 25, target: 26 },
};
