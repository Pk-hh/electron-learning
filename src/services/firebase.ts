import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyDnTg7O-_N-MJX4ub-NpIjh9VnstB8Hl7c",
  authDomain: "electron-learning.firebaseapp.com",
  projectId: "electron-learning",
  storageBucket: "electron-learning.firebasestorage.app",
  messagingSenderId: "78257173616",
  appId: "1:78257173616:web:0b94fc7911c18fbbda70b5",
  measurementId: "G-GJ715WXFLD"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
export const auth = getAuth(firebaseApp);

// Initialize anonymous auth for public student clients so Firestore view counter & reads are fully authenticated
signInAnonymously(auth).catch(err => {
  console.debug('Anonymous auth note (app works seamlessly offline/cached):', err);
});

// Analytics is optional (blocked in some environments)
isSupported().then(yes => yes ? getAnalytics(firebaseApp) : null).catch(() => null);
