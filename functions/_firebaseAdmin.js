import admin from "firebase-admin";

if (!admin.apps.length) {
  // If you use a service account, set env vars or parse JSON
  // Example with ADC on Netlify (recommended):
  // Netlify build/runtime will use GOOGLE_APPLICATION_CREDENTIALS if configured.
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    // For Realtime DB, set FIREBASE_DB_URL in Netlify env
    databaseURL: process.env.FIREBASE_DB_URL
  });
}

export default admin;
