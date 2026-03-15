import { initializeApp, FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, Auth } from "firebase/auth";

let app: FirebaseApp;
let auth: Auth;
const googleProvider = new GoogleAuthProvider();

googleProvider.addScope("https://www.googleapis.com/auth/gmail.modify");
googleProvider.addScope("https://www.googleapis.com/auth/userinfo.email");

async function initFirebase() {
  try {
    const res = await fetch("/api/config");
    const { firebase: config } = await res.json();

    if (config?.apiKey) {
      app = initializeApp(config);
      auth = getAuth(app);
      return { app, auth };
    }
  } catch (e) {
    console.warn("Could not fetch runtime config, falling back to build-time config");
  }

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

  throw new Error("Firebase configuration missing. Set VITE_FIREBASE_* env vars or expose them via /api/config.");
}

export const firebaseReady = initFirebase();
export { app, auth, googleProvider };
