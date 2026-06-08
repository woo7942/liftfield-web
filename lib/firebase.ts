import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyD-wMYrfOOy1PFlj5UHrsQDAXg4NpVbnlM",
  authDomain: "elevator-manager-59bb0.firebaseapp.com",
  projectId: "elevator-manager-59bb0",
  storageBucket: "elevator-manager-59bb0.firebasestorage.app",
  messagingSenderId: "446736559171",
  appId: "1:446736559171:web:76e4dc682b8cc064d5f8f6",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
