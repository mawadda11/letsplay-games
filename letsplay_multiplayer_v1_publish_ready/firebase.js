import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getDatabase, ref, get, set, update, remove, onValue, push, runTransaction, onDisconnect } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

export const firebaseConfig = {
  apiKey: "AIzaSyD7sezSZqMvCy-1Ico_aDwlHCJZqOfuwIc",
  authDomain: "letsplay-1e4c8.firebaseapp.com",
  databaseURL: "https://letsplay-1e4c8-default-rtdb.europe-west1.firebasedatabase.app/",
  projectId: "letsplay-1e4c8",
  storageBucket: "letsplay-1e4c8.firebasestorage.app",
  messagingSenderId: "550217425565",
  appId: "1:550217425565:web:02c38eff36a54daf85ea74"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export async function ensureAuth(){
  if(!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}

export { ref, get, set, update, remove, onValue, push, runTransaction, onDisconnect };
