// js/core/firebase-config.js
/**
 * Firebase Configuration for Dawaa PWA (v8.0.0)
 * Note: Replace placeholders with your own project details from Firebase Console.
 */

const firebaseConfig = {
    apiKey: "AIzaSyC7z7OxtCBPmb-yUpZo-yntbL27MtsJNtw",
    authDomain: "dawaa-6db2c.firebaseapp.com",
    projectId: "dawaa-6db2c",
    storageBucket: "dawaa-6db2c.firebasestorage.app",
    messagingSenderId: "7377940173",
    appId: "1:7377940173:web:c5c6845107553ec198c384",
    measurementId: "G-3446XLYPMC"
};


// Initialize Firebase (Compat mode for now to keep it simple with existing code)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

export const auth = firebase.auth();
export const db = firebase.firestore();

// Persistence for Firestore (Offline-First) - Essential for PWA
db.enablePersistence().catch((err) => {
    if (err.code == 'failed-precondition') {
        // Multiple tabs open, persistence can only be enabled in one tab at a time.
        console.warn('Firestore Persistence failed (multiple tabs)');
    } else if (err.code == 'unimplemented') {
        // The current browser does not support all of the features required to enable persistence
        console.warn('Firestore Persistence not supported by browser');
    }
});

console.log('Firebase: Initialized & Persistence Enabled ☁️');

