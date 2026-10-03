import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};
const requiredConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.storageBucket,
  firebaseConfig.messagingSenderId,
  firebaseConfig.appId,
];

export const isFirebaseConfigured = requiredConfig.every(
  (value) => typeof value === "string" && value.trim().length > 0,
);

const existingApp = isFirebaseConfigured && getApps().length ? getApp() : null;
const app = isFirebaseConfigured ? existingApp ?? initializeApp(firebaseConfig) : null;

export const auth = (app ? getAuth(app) : null) as Auth;
export const db = (app ? getFirestore(app) : null) as Firestore;
// UI tests use a demo project only. Production builds never connect to emulators.
if (app && !existingApp && process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "true") {
  if (!firebaseConfig.projectId?.startsWith("demo-")) throw new Error("Os emuladores exigem um projeto demo.");
  if (!auth.emulatorConfig) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8185);
}
// Analytics is intentionally not initialized here; this module also runs during SSR.
