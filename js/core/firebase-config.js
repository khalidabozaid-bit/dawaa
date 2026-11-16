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
export const storage = firebase.storage();

// Global Window Bindings for Legacy & Fallback Support
window.firebase = firebase;
window.auth = auth;
window.db = db;
window.storage = storage;


// Persistence for Firestore (Offline-First) - Essential for PWA
try {
    if (typeof db.enablePersistence === 'function') {
        db.enablePersistence().catch((err) => {
            if (err.code === 'failed-precondition') {
                console.warn('Firestore Persistence failed (multiple tabs open)');
            } else if (err.code === 'unimplemented') {
                console.warn('Firestore Persistence not supported by browser');
            } else {
                console.warn('Firestore Persistence notice:', err.message);
            }
        });
    }
} catch (e) {
    console.warn('Firestore enablePersistence call skipped:', e.message);
}

console.log('Firebase: Initialized & Persistence Enabled ☁️');

