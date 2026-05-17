import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAMeZR6LZboUvGP58WQyOaXlhjNfcBbkCA",
  authDomain: "dsp-workout.firebaseapp.com",
  projectId: "dsp-workout",
  storageBucket: "dsp-workout.firebasestorage.app",
  messagingSenderId: "731871767907",
  appId: "1:731871767907:web:f76b8f3ee2f72ce767f756",
  measurementId: "G-G6B09YKPDQ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
