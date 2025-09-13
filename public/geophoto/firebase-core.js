// firebase-core.js
// One-time Firebase init + shared helpers for Advanced Editor

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getDatabase, ref as dbRef, get } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";
import {
  getStorage, ref as stRef, getBlob, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

/* ---------------- Firebase config ---------------- */
export const firebaseConfig = {
  apiKey: "AIzaSyDM6DpRSeZueVKRpbyJyDmhf8WY66KyCDk",
  authDomain: "dailyquiz-d5279.firebaseapp.com",
  databaseURL: "https://dailyquiz-d5279-default-rtdb.firebaseio.com",
  projectId: "dailyquiz-d5279",
  storageBucket: "dailyquiz-d5279.firebasestorage.app",
  appId: "1:94577748034:web:c032d3a1d72db1313de5db",
  measurementId: "G-19DVN7NNH7"
};

/* ---------------- Singletons ---------------- */
let _app = null, _db = null, _auth = null, _storage = null;
let _bucketHost = "", _bucketGs = "";

/* ---------------- Bucket host normalization ---------------- */
function normalizeBucketHost(hostOrUrl = "") {
  if (!hostOrUrl) return "";
  if (/^gs:\/\//i.test(hostOrUrl)) return hostOrUrl.replace(/^gs:\/\//i, "");
  const matchGapi = hostOrUrl.match(/https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)/i);
  if (matchGapi) return matchGapi[1].replace(".firebasestorage.app", ".appspot.com");
  const matchApp = hostOrUrl.match(/https?:\/\/([^/]+)\.firebasestorage\.app/i);
  if (matchApp) return (matchApp[1] + ".appspot.com");
  return hostOrUrl.replace(".firebasestorage.app", ".appspot.com");
}

/* ---------------- Init / accessors ---------------- */
export function initFirebase(explicitBucketHost = "") {
  if (_app) return;
  _app = initializeApp(firebaseConfig);
  _db = getDatabase(_app);
  _auth = getAuth(_app);

  _bucketHost = normalizeBucketHost(explicitBucketHost || firebaseConfig.storageBucket);
  _bucketGs = `gs://${_bucketHost}`;
  _storage = getStorage(_app, _bucketGs);
}

export function getFirebase() {
  if (!_app) initFirebase();
  return { app: _app, db: _db, auth: _auth, storage: _storage, bucketHost: _bucketHost, bucketGs: _bucketGs };
}
export function getStorageInfo() {
  if (!_app) initFirebase();
  return { bucketHost: _bucketHost, bucketGs: _bucketGs };
}

/* ---------------- Auth ---------------- */
export async function ensureAuthed() {
  const { auth } = getFirebase();
  try { await setPersistence(auth, browserLocalPersistence); }
  catch { try { await setPersistence(auth, browserSessionPersistence); }
  catch { await setPersistence(auth, inMemoryPersistence); } }
  if (!auth.currentUser) {
    await signInAnonymously(auth);
    await new Promise(res => onAuthStateChanged(auth, u => u && res()));
  }
  return auth.currentUser;
}

/* ---------------- Ref coercion ---------------- */
/**
 * Convert various inputs into a ref string that works with `ref(storage, ...)`.
 * Returns one of:
 *  - `gs://bucket/path` (preferred)
 *  - `path/inside/current/bucket` (if already relative)
 *  - `https://...` (left as-is; handled via fetch branch)
 */
export function toStorageRefString(s) {
  if (!s) return s;
  let v = ("" + s).trim();
  try { v = decodeURIComponent(v); } catch {}
  if (v.startsWith("gs://")) return v; // pass through intact

  // googleapis style with token, etc.
  let m = v.match(/^https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/i);
  if (m) {
    const bucket = m[1].replace(".firebasestorage.app", ".appspot.com");
    const obj = m[2].replace(/\+/g, " ");
    return `gs://${bucket}/${obj}`;
  }

  // *.firebasestorage.app style
  m = v.match(/^https?:\/\/([^/]+)\.firebasestorage\.app\/o\/([^?]+)/i);
  if (m) {
    const
