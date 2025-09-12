// firebase-core.js
// One-time Firebase init + shared helpers for Advanced Editor
// NOTE: No scenario writes here. No AI calls here.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getDatabase, ref as dbRef, get } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";
import {
  getStorage, ref as stRef, getBlob, uploadBytes
  // IMPORTANT: do NOT import setMaxOperationRetryTime – not exported by your CDN build
  // You can optionally import setMaxUploadRetryTime if you really want, but it's not required.
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

/* ---------------- Firebase config ---------------- */
// (matches your project)
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
// Convert *.firebasestorage.app → *.appspot.com for gs:// usage
function normalizeBucketHost(hostOrUrl = "") {
  if (!hostOrUrl) return "";
  // If it's already gs://, strip scheme and return the host/path
  if (/^gs:\/\//i.test(hostOrUrl)) return hostOrUrl.replace(/^gs:\/\//i, "");
  // If it's a full https URL, try to extract the bucket
  const matchGapi = hostOrUrl.match(/https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)/i);
  if (matchGapi) return matchGapi[1].replace(".firebasestorage.app", ".appspot.com");
  const matchApp = hostOrUrl.match(/https?:\/\/([^/]+)\.firebasestorage\.app/i);
  if (matchApp) return matchApp[1] + ".appspot.com";
  return hostOrUrl.replace(".firebasestorage.app", ".appspot.com");
}

/* ---------------- Init / accessors ---------------- */
export function getFirebase() {
  if (!_app) initFirebase();
  return { app: _app, db: _db, auth: _auth, storage: _storage, bucketHost: _bucketHost, bucketGs: _bucketGs };
}

export function getStorageInfo() {
  if (!_app) initFirebase();
  return { bucketHost: _bucketHost, bucketGs: _bucketGs };
}

export function initFirebase(explicitBucketHost = "") {
  if (_app) return;

  _app = initializeApp(firebaseConfig);
  _db = getDatabase(_app);
  _auth = getAuth(_app);

  _bucketHost = normalizeBucketHost(explicitBucketHost || firebaseConfig.storageBucket);
  _bucketGs = `gs://${_bucketHost}`;
  _storage = getStorage(_app, _bucketGs);

  // We intentionally DO NOT call setMaxOperationRetryTime here because it
  // isn’t exported in your CDN build and causes a hard import error.
  // Default retry behavior is fine for your use case.
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

/* ---------------- Storage helpers ---------------- */
// Turn a URL or path into a Storage ref string (gs://bucket/path or bucket/path)
export function toStorageRefString(s) {
  if (!s) return s;
  let v = ("" + s).trim();
  try { v = decodeURIComponent(v); } catch {}
  if (v.startsWith("gs://")) return v.replace(/^gs:\/\//i, ""); // return without scheme for stRef
  // gapi style
  let m = v.match(/^https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/i);
  if (m) return `${m[1]}/${m[2].replace(/\+/g, " ")}`;
  // app subdomain style
  m = v.match(/^https?:\/\/([^/]+)\.firebasestorage\.app\/o\/([^?]+)/i);
  if (m) return `${normalizeBucketHost(m[1] + ".firebasestorage.app")}/${m[2].replace(/\+/g, " ")}`;
  // plain relative path in current bucket
  return v;
}

export async function getBlobFromRefString(refStr) {
  await ensureAuthed();
  const { storage } = getFirebase();
  const coerced = toStorageRefString(refStr);

  // If http(s), fetch directly
  if (/^https?:\/\//i.test(coerced)) {
    const r = await fetch(coerced, { mode: "cors", credentials: "omit", cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.blob();
  }

  const ref = stRef(storage, coerced);
  return await getBlob(ref);
}

// Produce likely “original” candidates from a thumbnail-ish URL/path
export function candidateOriginals(pathOrUrl) {
  const out = new Set();
  if (!pathOrUrl) return [];
  let s = pathOrUrl;
  try { s = decodeURIComponent(s); } catch {}
  const [base, qs] = s.split("?");
  const variants = new Set([base]);
  variants.add(base.replace(/\/thumbs\//i, "/"));
  variants.add(base.replace(/\/thumb_([^/]+)/i, "/$1"));
  variants.add(base.replace(/([-_])(thumb|small|preview|min|tiny)(\.[a-z0-9]+)$/i, "$3"));
  variants.forEach(v => variants.add(v.replace(/(\.[a-z0-9]+)\1$/i, "$1")));
  for (const v of variants) {
    const bucketPath = toStorageRefString(v);            // bucket/path or http(s)
    // Prefer gs-style reference where possible
    if (/^https?:\/\//i.test(bucketPath)) {
      out.add(bucketPath);
      if (qs) out.add(`${v}?${qs}`);
    } else {
      out.add(bucketPath); // bucket/path
    }
  }
  return Array.from(out).filter(Boolean);
}

// Lightweight helper for healthchecks/debug writes
export async function uploadSmallText(path, text, contentType = "text/plain") {
  const { storage } = getFirebase();
  const ref = stRef(storage, path);
  const blob = new Blob([new TextEncoder().encode(text)], { type: contentType });
  await uploadBytes(ref, blob, { cacheControl: "no-store" });
  return path;
}

/* ---------------- Root detection used by scenarios.js ---------------- */
export async function detectScenariosRoot() {
  const { db } = getFirebase();
  try {
    const snap = await get(dbRef(db, "geophoto/scenarios"));
    if (snap.exists()) return "geophoto/scenarios";
  } catch {}
  return "scenarios";
}
