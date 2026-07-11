// =====================================================
// Firebase configuration
// IMPORTANT: This must be a NEW, SEPARATE Firebase project
// for KK's Society — do not reuse the Sahyog Society project,
// or member/loan data from both societies will mix together.
//
// Steps:
// 1. Go to https://console.firebase.google.com → Add project
//    → name it something like "kks-society"
// 2. Enable Authentication → Sign-in method → Email/Password
// 3. Create a Firestore database (production mode, nearest region)
// 4. Project Settings → General → Your apps → Add app (Web)
// 5. Copy the config values it gives you into the object below
// =====================================================
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDEPUGPbMHgUyQ6ntCl0Hy1c49h1dIn0Ow",
  authDomain: "kk-s-society.firebaseapp.com",
  projectId: "kk-s-society",
  storageBucket: "kk-s-society.firebasestorage.app",
  messagingSenderId: "866709566171",
  appId: "1:866709566171:web:6137cd4c231f3dc77e52fe",
  measurementId: "G-V5M739R96P"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Username-based login maps to a fake internal email so we can
// keep using Firebase Auth's email/password sign-in under the hood.
function usernameToEmail(username){
  return username.trim().toLowerCase().replace(/[^a-z0-9._-]/g,'') + "@kks.local";
}
