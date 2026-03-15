import { initializeApp, FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";

// We'll initialize these lazily or after fetching config
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
const googleProvider = new GoogleAuthProvider();

// Add Gmail scopes
googleProvider.addScope("https://www.googleapis.com/auth/gmail.modify");
googleProvider.addScope("https://www.googleapis.com/auth/userinfo.email");

async function initFirebase() {
  // Try to fetch from server first (runtime config)
  try {
    const res = await fetch("/api/config");
    const { firebase: config } = await res.json();
    
    if (config.apiKey) {
      app = initializeApp(config);
      auth = getAuth(app);
      db = getFirestore(app, config.firestoreDatabaseId || "(default)");
      return { app, auth, db };
    }
  } catch (e) {
    console.warn("Could not fetch runtime config, falling back to build-time config");
  }

  // Fallback to build-time env vars
  const buildTimeConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID
  };

  if (buildTimeConfig.apiKey) {
    app = initializeApp(buildTimeConfig);
    auth = getAuth(app);
    db = getFirestore(app, buildTimeConfig.firestoreDatabaseId || "(default)");
    return { app, auth, db };
  }

  // Final fallback to JSON file
  try {
    // @ts-ignore
    const firebaseConfig = await import("../firebase-applet-config.json");
    app = initializeApp(firebaseConfig.default || firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app, (firebaseConfig.default || firebaseConfig).firestoreDatabaseId || "(default)");
    return { app, auth, db };
  } catch (e) {
    throw new Error("Firebase configuration missing. Set VITE_FIREBASE_* env vars or provide firebase-applet-config.json");
  }
}

// Export a promise that resolves when Firebase is ready
export const firebaseReady = initFirebase();

// We still need to export these, but they will be undefined until firebaseReady resolves
// This means components should wait for firebaseReady or handle undefined
export { app, auth, db, googleProvider };
