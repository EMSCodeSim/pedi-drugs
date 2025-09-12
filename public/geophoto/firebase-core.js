// firebase-core.js
// One-time Firebase init + safe, shared helpers.
// No scenario writes or AI logic here.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";
import {
  getStorage, ref as stRef, getBlob, uploadBytes,
  setMaxUploadRetryTime, setMaxOperationRetryTime
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDM6DpRSeZueVKRpbyJyDmhf8WY66KyCDk",
  authDomain: "dailyquiz-d5279.firebaseapp.com",
  databaseURL: "https://dailyquiz-d5279-default-rtdb.firebaseio.com",
  projectId: "dailyquiz-d5279",
  storageBucket: "dailyquiz-d5279.firebasestorage.app",
  appId: "1:94577748034:web:c032d3a1d72db1313de5db",
  measurementId: "G-19DVN7NNH7"
};

// ----- singletons -----
let _app, _db, _auth, _storage, _bucketHost, _bucketGs;

// Normalize host → appspot for gs:// usage
function normalizeBucketHost(host) {
  if (!host) return "";
  host = host.trim();
  if (host.endsWith(".firebasestorage.app")) return host.replace(".firebasestorage.app", ".appspot.com");
  return host; // already appspot.com or custom
}

export function initFirebase(explicitBucketHost = "dailyquiz-d5279.appspot.com") {
  if (_app) return; // idempotent
  _app = initializeApp(firebaseConfig);
  _db = getDatabase(_app);
  _auth = getAuth(_app);

  _bucketHost = normalizeBucketHost(explicitBucketHost || firebaseConfig.storageBucket);
  _bucketGs = `gs://${_bucketHost}`;
  _storage = getStorage(_app, _bucketGs);

  // Tighter retry windows (prevents minutes of silent stalls)
  setMaxUploadRetryTime(_storage, 60_000);
  setMaxOperationRetryTime(_storage, 60_000);
}

export function getFirebase() {
  if (!_app) initFirebase();
  return { app: _app, db: _db, auth: _auth, storage: _storage };
}

export async function ensureAuthed() {
  const { auth } = getFirebase();
  try { await setPersistence(auth, browserLocalPersistence); }
  catch {
    try { await setPersistence(auth, browserSessionPersistence); }
    catch { await setPersistence(auth, inMemoryPersistence); }
  }
  if (!auth.currentUser) {
    await signInAnonymously(auth);
    await new Promise(res => onAuthStateChanged(auth, u => u && res(), { once: true }));
  }
  return auth.currentUser;
}

export function getStorageInfo() {
  if (!_app) initFirebase();
  return { bucketHost: _bucketHost, bucketGs: _bucketGs };
}

// ---------- Storage URL helpers (pure) ----------
export function toStorageRefString(input) {
  if (!input) return input;
  let v = String(input).trim();
  try { v = decodeURIComponent(v); } catch {}
  if (v.startsWith("gs://")) return v;

  // Signed/unsigned googleapis
  let m = v.match(/^https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/i);
  if (m) return `gs://${normalizeBucketHost(m[1])}/${m[2].replace(/\+/g, " ")}`;

  // *.firebasestorage.app/o/<path>
  m = v.match(/^https?:\/\/([^/]+)\.firebasestorage\.app\/o\/([^?]+)/i);
  if (m) return `gs://${normalizeBucketHost(m[1])}/${m[2].replace(/\+/g, " ")}`;

  // plain path
  if (!/^https?:\/\//i.test(v)) return v;
  return v; // external http(s), return as-is
}

export async function getBlobFromRefString(refStr) {
  const { storage } = getFirebase();
  await ensureAuthed();
  const coerced = toStorageRefString(refStr);

  if (/^https?:\/\//i.test(coerced)) {
    const r = await fetch(coerced, { mode: "cors", credentials: "omit", cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.blob();
  }
  const ref = stRef(storage, coerced);
  return await getBlob(ref);
}

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
    const gs = toStorageRefString(v);
    out.add(gs);
    if (/^https?:\/\//i.test(s) && qs) out.add(`${v}?${qs}`);
  }
  return Array.from(out).filter(Boolean);
}

// lightweight utility for quick writes (used by AI, optional)
export async function uploadSmallText(path, text, contentType = "text/plain") {
  const { storage } = getFirebase();
  const ref = stRef(storage, path);
  const blob = new Blob([new TextEncoder().encode(text)], { type: contentType });
  await uploadBytes(ref, blob, { cacheControl: "no-store" });
  return path;
}
