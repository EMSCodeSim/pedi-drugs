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
    const bucket = normalizeBucketHost(m[1] + ".firebasestorage.app"); // -> *.appspot.com
    const obj = m[2].replace(/\+/g, " ");
    return `gs://${bucket}/${obj}`;
  }

  // If it's a plain http(s) to some CDN or external host, keep it as URL
  if (/^https?:\/\//i.test(v)) return v;

  // Otherwise it's already a relative path inside the current bucket
  return v;
}

/* ---------------- Blob fetch with timeout ---------------- */
function withTimeout(promise, ms, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(label), { code: label })), ms))
  ]);
}

/**
 * Get a Blob from a Storage ref *or* an HTTP URL.
 * - Prefers Storage SDK for `gs://` and relative paths.
 * - Falls back to `fetch` for http(s).
 * - Times out (rejects) after `timeoutMs` (default 25s).
 */
export async function getBlobFromRefString(refStr, timeoutMs = 25000) {
  await ensureAuthed();
  const { storage } = getFirebase();
  const coerced = toStorageRefString(refStr);

  try {
    // http(s) — fetch directly
    if (/^https?:\/\//i.test(coerced)) {
      const r = await withTimeout(
        fetch(coerced, { mode: "cors", credentials: "omit", cache: "no-store" }),
        timeoutMs,
        "storage/fetch-timeout"
      );
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.blob();
    }

    // gs://bucket/path  OR relative path
    const ref = stRef(storage, coerced); // SDK accepts both `gs://...` and `relative/path`
    return await withTimeout(getBlob(ref), timeoutMs, "storage/getblob-timeout");
  } catch (err) {
    // Helpful console for debugging paths
    console.warn("[getBlobFromRefString] failed:", { input: refStr, coerced }, err);
    throw err;
  }
}

/* ---------------- Originals candidate generator ---------------- */
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
    const gsOrPath = toStorageRefString(v); // may become gs://bucket/path
    out.add(gsOrPath);
    if (/^https?:\/\//i.test(s) && qs) out.add(`${v}?${qs}`);
  }
  return Array.from(out).filter(Boolean);
}

/* ---------------- Misc helpers ---------------- */
export async function uploadSmallText(path, text, contentType = "text/plain") {
  const { storage } = getFirebase();
  const ref = stRef(storage, path);
  const blob = new Blob([new TextEncoder().encode(text)], { type: contentType });
  await uploadBytes(ref, blob, { cacheControl: "no-store" });
  return await getDownloadURL(ref);
}

/* ---------------- Root detection for scenarios.js ---------------- */
export async function detectScenariosRoot() {
  const { db } = getFirebase();
  try {
    const snap = await get(dbRef(db, "geophoto/scenarios"));
    if (snap.exists()) return "geophoto/scenarios";
  } catch {}
  return "scenarios";
}
