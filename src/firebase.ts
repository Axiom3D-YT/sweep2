import { initializeApp, FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, Auth } from "firebase/auth";

// We'll initialize these lazily or after fetching config
let app: FirebaseApp;
let auth: Auth;
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
      return { app, auth };
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
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  };

  if (buildTimeConfig.apiKey) {
    app = initializeApp(buildTimeConfig);
    auth = getAuth(app);
    return { app, auth };
  }

  // Final fallback to JSON file
  try {
    // @ts-ignore
    const firebaseConfig = await import("../firebase-applet-config.json");
    const config = firebaseConfig.default || firebaseConfig;
    app = initializeApp(config);
    auth = getAuth(app);
    return { app, auth };
  } catch (e) {
    throw new Error("Firebase configuration missing. Set VITE_FIREBASE_* env vars or provide firebase-applet-config.json");
  }
}

// Export a promise that resolves when Firebase is ready
export const firebaseReady = initFirebase();

// We still need to export these, but they will be undefined until firebaseReady resolves
export { app, auth, googleProvider };
