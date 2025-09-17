// scenarios.js — Storage-only scenario loader with robust listing + fullsize display
// Place this file next to your HTML. Requires firebase-core.js in the same folder.

import {
  getFirebase,
  ensureAuthed,
  getStorageInfo,
  toStorageRefString,
  candidateOriginals
} from "./firebase-core.js";

import {
  ref as dbRef,
  set,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

import {
  ref as stRef,
  getDownloadURL,
  listAll,
  getBlob as storageGetBlob,
  uploadBytesResumable,
  deleteObject,
  getMetadata
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ----------------- tiny DOM helpers ----------------- */
const $ = (id) => document.getElementById(id);
const log  = (...a) => { try{ console.log("[scenarios]", ...a); }catch(_){} };
const warn = (...a) => { try{ console.warn("[scenarios]", ...a); }catch(_){} };

export function setAuthPill(t){ const el=$("authPill"); if (el) el.textContent="Auth: "+t; }
export function setStatus(t){ const el=$("statusPill"); if (el) el.textContent=t; log(t); }
export function setRootPill(t){ const el=$("rootPill"); if (el) el.textContent=t; }
export function setAIStatus(t){ const el=$("aiMsg"); if (el) el.textContent=t; }
function showError(msg){ const b=$("errbar"); if (!b) return; b.style.display="block"; b.textContent=String(msg); warn(msg); }
function hideError(){ const b=$("errbar"); if (b) b.style.display="none"; }
function showLoad(on){ const ld=$("loader"); if (ld) ld.style.display = on ? "grid" : "none"; }
function setExportEnabled(on){ for (const id of ["exportPNG","saveImage"]){ const btn=$(id); if (btn) btn.disabled=!on; } }

/* ----------------- canvas (fabric) ----------------- */
let f=null, baseImage=null, baseTainted=false, lastBaseURL=null;

function ensureCanvas(){
  if (f) return f;
  if (!window.fabric) throw new Error("fabric not loaded");
  f = new fabric.Canvas("c", { backgroundColor:"#061621", preserveObjectStacking:true });
  window.addEventListener("resize", fitCanvas);
  const info = $("canvasInfo"); if (info) info.textContent = "Canvas ready.";
  fitCanvas(); return f;
}
export function fitCanvas(){
  const cEl = $("c"); if (!cEl || !f) return;
  const fullsize = !!($("fullsizeToggle")?.checked);

  if (baseImage && fullsize){
    const bw = baseImage.width  || 1, bh = baseImage.height || 1;
    f.setWidth(bw); f.setHeight(bh);
    baseImage.set({ scaleX:1, scaleY:1, left:0, top:0 });
    f.requestRenderAll(); return;
  }

  const wrap = cEl.parentElement || document.body;
  const targetW = Math.max(320, wrap.clientWidth - 8);
  const targetH = Math.max(240, wrap.clientHeight - 8);
  f.setWidth(targetW); f.setHeight(targetH);

  if (baseImage){
    const bw = baseImage.width || 1, bh = baseImage.height || 1;
    const scale = Math.min(targetW/bw, targetH/bh);
    baseImage.set({
      scaleX:scale, scaleY:scale,
      left:(targetW - bw*scale)/2,
      top:(targetH - bh*scale)/2
    });
  }
  f.requestRenderAll();
}
export function isCanvasTainted(){ return !!baseTainted; }
export function getLastLoadedBaseURL(){ return lastBaseURL; }

/* ----------------- fetch helpers ----------------- */
async function blobFromURL(url, timeoutMs){
  const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), timeoutMs || 15000);
  try{
    const r = await fetch(url, { signal: ctrl.signal, mode:"cors", cache:"force-cache" });
    if (!r.ok) throw new Error("fetch-failed " + r.status);
    return await r.blob();
  } finally { clearTimeout(t); }
}
function withTimeout(p, ms, tag){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error(tag || "timeout")), ms);
    p.then(v=>{ clearTimeout(t); resolve(v); }).catch(e=>{ clearTimeout(t); reject(e); });
  });
}

/* --- fabric load with fullsize toggle + <img> fallback --- */
async function setBaseFromBlob(blob){
  ensureCanvas(); baseTainted=false;
  const url = URL.createObjectURL(blob);

  return await new Promise((resolve, reject)=>{
    fabric.Image.fromURL(url, (img)=>{
      if (!img) { URL.revokeObjectURL(url); reject(new Error("img-null")); return; }

      baseImage = img;
      img.set({ selectable:false, evented:false, erasable:false });

      const fb = $("fullsizeFallback"); if (fb){ fb.style.display="none"; fb.src=""; }

      f.clear(); f.add(img); img.moveTo(0);
      if ($("fullsizeToggle")?.checked){
        f.setWidth(img.width); f.setHeight(img.height);
        img.set({ left:0, top:0, scaleX:1, scaleY:1 });
      }
      fitCanvas(); f.requestRenderAll(); setExportEnabled(true);

      const info = $("canvasInfo");
      if (info) info.textContent = `Base image: ${img.width}×${img.height}`;

      setTimeout(()=>URL.revokeObjectURL(url), 0);
      resolve({ w:img.width, h:img.height });
    }, { crossOrigin:"anonymous" });
  }).catch(err=>{
    const fb = $("fullsizeFallback");
    if (fb){ fb.src=url; fb.style.display="block"; }
    setExportEnabled(false);
    throw err;
  });
}

/* ----------------- Storage REST fallback ----------------- */
function deriveBucketNames(){
  const { app } = getFirebase();
  const cfg = (app && app.options) || {};
  let sb = String(cfg.storageBucket || "").replace(/^gs:\/\//,"").replace(/\/.*/,"");
  const appspot = sb.includes("appspot.com") ? sb : (sb ? `${sb.replace(/\.firebasestorage\.app$/,"")}.appspot.com` : "");
  const fsa     = sb.includes("firebasestorage.app") ? sb : (sb ? `${sb.replace(/\.appspot\.com$/,"")}.firebasestorage.app` : "");
  return { appspot, fsa };
}
async function getAuthBearer(){
  try{
    const u = await ensureAuthed();
    if (u && u.getIdToken) return "Bearer " + await u.getIdToken();
  }catch(_){}
  return null;
}
function ensurePrefixSlash(p){
  const s = String(p || "").replace(/^\/+/,"");
  return s.endsWith("/") ? s : (s + "/");
}
async function listFolderREST(bucketHost, prefixPath){
  const prefix = ensurePrefixSlash(prefixPath);
  const url = "https://firebasestorage.googleapis.com/v0/b/" +
              encodeURIComponent(bucketHost) +
              "/o?delimiter=%2F&prefix=" + encodeURIComponent(prefix);
  const hdrs = { "Accept": "application/json" };
  const bearer = await getAuthBearer(); if (bearer) hdrs["Authorization"] = bearer;
  const r = await fetch(url, { headers: hdrs, cache: "no-store" });
  if (!r.ok){ const txt = await r.text().catch(()=> ""); throw new Error(`REST ${bucketHost} → ${r.status} ${txt.slice(0,200)}`); }
  const j = await r.json();
  const prefixes = Array.isArray(j.prefixes) ? j.prefixes.map(x => x.replace(/\/$/,"")) : [];
  const items    = Array.isArray(j.items)    ? j.items.map(x => ({ name: x.name }))    : [];
  return { prefixes, items };
}
async function listFolderCombined(prefixPath){
  const { storage } = getFirebase();
  const norm = String(prefixPath || "").replace(/^\/+/,"").replace(/\/+$/,"");
  // 1) SDK
  try {
    const res = await listAll(stRef(storage, norm));
    const prefixes = (res.prefixes || []).map(p => (norm ? `${norm}/${p.name}` : p.name));
    const items    = (res.items || []).map(it => ({ name: it.fullPath || (norm ? `${norm}/${it.name}` : it.name) }));
    return { prefixes, items };
  } catch (e) {
    warn("SDK listAll failed at", norm || "(root)", e?.message || e);
  }
  // 2) REST fallbacks
  const { appspot, fsa } = deriveBucketNames();
  let err = null;
  if (fsa) { try { return await listFolderREST(fsa, norm); } catch(e){ err=e; warn("REST fsa failed:", e?.message || e); } }
  if (appspot) { try { return await listFolderREST(appspot, norm); } catch(e){ err=e; warn("REST appspot failed:", e?.message || e); } }
  throw err || new Error("list failed");
}

/* ----------------- Scenario state ----------------- */
const FORCE_ROOT = "scenarios";
let ROOT = FORCE_ROOT;

let scenarios = [];   // [{id, title, _raw, _stops}]
let current   = null; // current scenario object
let stopIndex = -1;

/* ----------------- scenarios list (folders) ----------------- */
async function listScenarioIdsFromStorage(root) {
  const clean = String(root || "").replace(/^\/+|\/+$/g, "");
  setStatus(`Listing '${clean}/'…`);
  try {
    const { prefixes } = await listFolderCombined(clean);
    // Example: returns ["scenarios/-OZFb...","scenarios/-OYr8..."]
    const ids = (prefixes || [])
      .map(full => full.replace(/^scenarios\/?/,""))
      .filter(Boolean);
    log("Scenario IDs:", ids);
    return ids;
  } catch (e) {
    showError("Storage list error under '" + clean + "': " + (e?.message || e));
    return [];
  }
}

/* ----------------- images deep-scan ----------------- */
const MAX_COLLECT = 500;

// skip only junk paths
function shouldSkipFolderPath(path){
  const p = String(path || "").toLowerCase();
  if (p.endsWith("/ai/results")) return true;
  const leaf = p.split("/").pop() || "";
  if (leaf === "overlays" || leaf === "masks") return true;
  return false;
}

async function listImagesDeep(prefixPath, maxDepth){
  const out = [];
  const queue = [{ path: String(prefixPath || "").replace(/\/+$/,""), depth: 0 }];
  let scanned = 0;

  while (queue.length) {
    const { path, depth } = queue.shift();
    scanned++;

    // try up to 2 times per level (SDK → REST)
    let listing = null;
    for (let attempt=0; attempt<2; attempt++){
      try { listing = await listFolderCombined(path); break; }
      catch (e){ if (attempt===1) { warn("list failed at", path, e?.message || e); } }
    }
    if (!listing) continue;

    // accept ALL items here; we'll filter by MIME later when we fetch metadata
    for (const it of (listing.items || [])) {
      const full = it.name || "";
      if (full) out.push(full);
      if (out.length >= MAX_COLLECT) break;
    }
    if (out.length >= MAX_COLLECT) break;

    if (depth < maxDepth) {
      for (const p of (listing.prefixes || [])) {
        if (!shouldSkipFolderPath(p)) queue.push({ path: p, depth: depth + 1 });
      }
    }
  }

  log("Scanned:", scanned, "Collected (raw):", out.length, "under", prefixPath);
  return out;
}

/* ----------------- UI helpers ----------------- */
function setStops(sc, stops){
  const next = Object.assign({}, sc || {});
  next.stops = Array.isArray(stops) ? stops.slice() : [];
  next.photos = undefined; next.images = undefined;
  current._raw = next;
  current._stops = next.stops;
}
function populateScenarios(){
  const sel = $("scenarioSel"); if (!sel) return;
  sel.innerHTML = '<option value="">Select scenario…</option>';
  for (const sc of scenarios){
    const o = document.createElement("option");
    o.value = sc.id; o.textContent = sc.title || sc.id;
    sel.appendChild(o);
  }
}
function dataURLFromStored(stored){
  if (typeof stored === "string") return stored;
  if (stored && stored.data) return "data:image/" + (stored.format || "jpeg") + ";base64," + stored.data;
  return "";
}
function renderThumbs(){
  const row = $("thumbRow"); if (!row) return;
  row.innerHTML = "";
  if (!current || !current._stops || current._stops.length === 0){
    row.innerHTML = '<div class="pill small">No photos/slides</div>';
    return;
  }
  for (let i=0;i<current._stops.length;i++){
    const s = current._stops[i];
    const img = document.createElement("img");
    const thumbSrc = s.thumbURL || s.imageURL || dataURLFromStored(s.imageData) || "";
    img.className = "thumb" + (i === stopIndex ? " active" : "");
    img.src = thumbSrc;
    img.alt = s.title || ("Stop " + (i+1));
    img.onerror = function(){
      img.src = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84"><rect width="100%" height="100%" fill="#111"/><text x="50%" y="54%" fill="#fff" font-size="14" text-anchor="middle">No image</text></svg>');
    };
    img.onclick = function(){ loadStop(i); };
    row.appendChild(img);
  }
}

/* ----------------- stop loading ----------------- */
async function getBlobSDKFirst(refLike, timeoutMs){
  try{
    const { storage } = getFirebase();
    const ref = stRef(storage, toStorageRefString(refLike));
    const blob = await withTimeout(storageGetBlob(ref), timeoutMs || 20000, "storage/getblob-timeout");
    return blob;
  }catch(_){
    try{
      const url = /^https?:\/\//i.test(refLike) ? refLike : await getDownloadURL(stRef(getFirebase().storage, toStorageRefString(refLike)));
      const blob = await withTimeout(blobFromURL(url, 15000), timeoutMs || 20000, "fetch-timeout");
      baseTainted = true; return blob;
    }catch(e2){ throw e2; }
  }
}

async function resolveForStop(stop, timeoutMs){
  const seeds = [
    stop.imageURL, stop.gsUri, stop.storagePath, stop.thumbURL,
    stop && stop.imageData && stop.imageData.data
      ? "data:image/" + (stop.imageData.format || "jpeg") + ";base64," + stop.imageData.data
      : null
  ].filter(Boolean);

  const extras = [];
  for (const s of seeds){
    const cands = candidateOriginals(s).slice(0, 6);
    for (const c of cands) extras.push(c);
  }

  const tried = new Set();
  for (const s of seeds){
    if (tried.has(s)) continue; tried.add(s);
    try{ const bl = await getBlobSDKFirst(s, timeoutMs); lastBaseURL = s; return bl; }catch(_){}
  }
  for (const s of extras){
    if (tried.has(s)) continue; tried.add(s);
    try{ const bl = await getBlobSDKFirst(s, timeoutMs); lastBaseURL = s; return bl; }catch(_){}
  }
  throw new Error("Could not resolve image for stop.");
}

export async function loadStop(i){
  hideError();
  if (!current) return;
  const s = current._stops[i]; if (!s) return;
  stopIndex = i;

  const row = $("thumbRow");
  if (row){ Array.from(row.children).forEach((k,idx)=>k.classList.toggle("active", idx===i)); }

  const ttl = $("stopTitle"); if (ttl) ttl.value = s.title || "";
  const cap = $("stopCaption"); if (cap) cap.value = s.caption || "";
  const lat = $("stopLat"); if (lat) lat.value = s.lat != null ? s.lat : "";
  const lng = $("stopLng"); if (lng) lng.value = s.lng != null ? s.lng : "";
  const rad = $("stopRadius"); if (rad) rad.value = s.radiusMeters != null ? s.radiusMeters : 50;

  try{
    showLoad(true);
    const blob = await resolveForStop(s, 25000);
    await setBaseFromBlob(blob);
  } catch (e){
    if (s.imageData && s.imageData.data){
      setBaseAsTextSlide("(embedded data render failed; showing text)");
    } else {
      showError("Load failed: " + (e && (e.message || e)));
    }
  } finally { showLoad(false); }
}

/* ----------------- text slide ----------------- */
export function setBaseAsTextSlide(text, fontSize){
  ensureCanvas(); f.clear();
  const rect = new fabric.Rect({ left:0, top:0, width:f.getWidth(), height:f.getHeight(), fill:"#000", selectable:false, evented:false, erasable:false });
  baseImage = rect;
  const tb = new fabric.Textbox(text || "", {
    width: Math.floor(f.getWidth()*0.8), left: Math.floor(f.getWidth()*0.1), top: Math.floor(f.getHeight()*0.2),
    fontSize: fontSize || 34, fill:"#fff", textAlign:"center",
    fontFamily:"system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif",
    selectable:false, evented:false, erasable:false
  });
  tb.isBaseText = true;
  f.add(rect); f.add(tb); rect.moveTo(0); f.requestRenderAll();
  baseTainted = false; lastBaseURL = "data:text/plain;base64," + btoa(text || "");
  setExportEnabled(true);
}

/* ----------------- AI / export helpers ----------------- */
export function hasOverlays(){ if (!f) return false; return f.getObjects().some(o => o && !o.isBaseText && o !== baseImage); }
export function getCompositeDataURL(){ if (!f || baseTainted) return null; try{ return f.toDataURL({ format:"png", quality:0.92, multiplier:1 }); }catch(_e){ return null; } }
export async function getGuideImageURLForCurrentStop(){
  if (!current || stopIndex < 0) throw new Error("No stop selected");
  const s = current._stops[stopIndex];
  if (lastBaseURL && (/^https?:\/\//i.test(lastBaseURL) || lastBaseURL.startsWith("data:") || lastBaseURL.startsWith("blob:"))) return lastBaseURL;
  if (s && s.imageURL && /^https?:\/\//i.test(s.imageURL)) return s.imageURL;
  const refLike = s.gsUri || s.storagePath || s.thumbURL || s.imageURL;
  if (refLike){
    const { storage } = getFirebase();
    const r = stRef(storage, toStorageRefString(refLike));
    return await getDownloadURL(r);
  }
  if (s && s.imageData && s.imageData.data) return "data:image/" + (s.imageData.format || "jpeg") + ";base64," + s.imageData.data;
  throw new Error("This stop has no accessible base image.");
}
export async function saveResultBlobToStorage(blob){
  if (!current || stopIndex < 0) throw new Error("No stop selected");
  const { storage } = getFirebase();
  const ts = Date.now();
  const path = `${ROOT}/${current.id}/ai/results/${ts}_stop${stopIndex}.jpg`;
  const ref = stRef(storage, path);
  await new Promise((resolve, reject)=>{
    const task = uploadBytesResumable(ref, blob, { contentType:"image/jpeg", cacheControl:"public,max-age=31536000,immutable" });
    const t = setTimeout(()=>{ try{ task.cancel(); }catch(_e){}; reject(Object.assign(new Error("upload/timeout"),{code:"upload/timeout"})); }, 90000);
    task.on("state_changed", function(){}, err=>{ clearTimeout(t); reject(err); }, ()=>{ clearTimeout(t); resolve(); });
  });
  return await getDownloadURL(ref);
}
export async function addResultAsNewStop(url){
  if (!current || stopIndex < 0) return;
  const base = current._stops[stopIndex];
  const newStop = { type:"photo", title:(base.title||"")+" (AI)", caption:"AI composite", imageURL:url, storagePath:null, radiusMeters:50, lat: base.lat, lng: base.lng };
  const next = current._stops.slice(); next.push(newStop);
  const updated = Object.assign({}, current._raw); setStops(updated, next);
  try{ await set(dbRef(getFirebase().db, ROOT + "/" + current.id), updated); }catch(_){}
  renderThumbs();
}

/* ----------------- build stops from storage ----------------- */
async function ensureStopsForCurrentFromStorage() {
  if (!current || (current._stops && current._stops.length)) return;

  const basePath = `${ROOT}/${current.id}`.replace(/\/+$/,"");
  setStatus(`Looking for files under '${basePath}/'…`);

  let filePaths = await listImagesDeep(basePath, 6);

  // Show first few for quick visual debugging
  if (filePaths.length) {
    const sample = filePaths.slice(0, 5).map(p => p.split("/").pop()).join(", ");
    setStatus(`Found ${filePaths.length} file(s). e.g., ${sample}${filePaths.length>5?"…":""}`);
  } else {
    setStatus("No items from first pass. Retrying via REST…");
    // Retry: force REST both bucket hosts
    try {
      const { appspot, fsa } = deriveBucketNames();
      let rest = { prefixes:[], items:[] };
      if (fsa) rest = await listFolderREST(fsa, basePath);
      else if (appspot) rest = await listFolderREST(appspot, basePath);
      filePaths = (rest.items || []).map(x => x.name).filter(Boolean);
      if (filePaths.length){
        const sample2 = filePaths.slice(0, 5).map(p => p.split("/").pop()).join(", ");
        setStatus(`REST found ${filePaths.length} file(s). e.g., ${sample2}${filePaths.length>5?"…":""}`);
      }
    } catch (e){ warn("Forced REST retry failed:", e?.message || e); }
  }

  if (!filePaths.length) {
    setStatus("No images found in storage for this scenario.");
    current._stops = []; renderThumbs(); return;
  }

  // Resolve content types so we only keep images
  const { storage } = getFirebase();
  const metaOK = [];
  for (const p of filePaths){
    try {
      const md = await getMetadata(stRef(storage, p));
      const ct = (md && md.contentType) || "";
      if (/^image\//i.test(ct)) metaOK.push(p);
    } catch(_){ /* if metadata blocked, keep it (likely image) */ metaOK.push(p); }
  }
  if (!metaOK.length){ metaOK.push(...filePaths); }

  metaOK.sort((a,b)=> a.localeCompare(b, undefined, { numeric:true, sensitivity:"base" }));

  const stops = new Array(metaOK.length);
  let i = 0;
  const conc = Math.min(6, metaOK.length);

  async function worker(){
    while (true) {
      const idx = i++; if (idx >= metaOK.length) break;
      const fullPath = metaOK[idx];
      try {
        const url = await getDownloadURL(stRef(storage, fullPath));
        const title = fullPath.split("/").pop() || "photo";
        stops[idx] = { type:"photo", title, storagePath:fullPath, imageURL:url, radiusMeters:50 };
      } catch (e) {
        warn("getDownloadURL failed:", fullPath, e?.message || e);
        stops[idx] = null;
      }
      if (idx % 10 === 0) setStatus(`Fetching URLs… ${idx+1}/${metaOK.length}`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));

  current._stops = stops.filter(Boolean);
  setStops(current._raw, current._stops);
  renderThumbs();
  setStatus(`${current._stops.length} photo(s)`);

  if (current._stops.length > 0) { try { await loadStop(0); } catch(_) {} }
}

/* ----------------- UI wiring ----------------- */
export function wireScenarioUI(){
  const toggleBtn = $("toggleTools");
  if (toggleBtn){
    toggleBtn.onclick = function(){
      const app = $("app"); if (!app) return;
      const collapse = !app.classList.contains("toolsCollapsed");
      app.classList.toggle("toolsCollapsed", collapse);
      toggleBtn.textContent = collapse ? "Show Tools" : "Hide Tools";
      fitCanvas();
    };
  }

  const fullToggle = $("fullsizeToggle");
  if (fullToggle) fullToggle.addEventListener("change", ()=> fitCanvas());

  const sel = $("scenarioSel");
  if (sel){
    sel.onchange = async function(){
      const id = sel.value;
      current = scenarios.find(s => s.id === id) || null;
      stopIndex = -1;
      renderThumbs();
      if (f){ f.clear(); baseImage=null; fitCanvas(); }
      if (current) {
        await ensureStopsForCurrentFromStorage();
        if (current._stops && current._stops.length > 0){ await loadStop(0); }
        else { setStatus("No images in this storage folder."); }
      }
    };
  }

  const gps = $("useGPS");
  if (gps){
    gps.onclick = function(){
      navigator.geolocation.getCurrentPosition(function(p){
        const lat=$("stopLat"); if (lat) lat.value=p.coords.latitude.toFixed(6);
        const lng=$("stopLng"); if (lng) lng.value=p.coords.longitude.toFixed(6);
      });
    };
  }

  const saveMeta = $("saveMeta");
  if (saveMeta){
    saveMeta.onclick = async function(){
      try{
        if (!current || stopIndex < 0) return;
        await ensureAuthed();
        const s = Object.assign({}, current._stops[stopIndex]);
        const title=$("stopTitle"); if (title) s.title = title.value || "";
        const cap=$("stopCaption"); if (cap) s.caption = cap.value || "";
        const lat=$("stopLat"); if (lat && lat.value) s.lat = parseFloat(lat.value);
        const lng=$("stopLng"); if (lng && lng.value) s.lng = parseFloat(lng.value);
        const rad=$("stopRadius"); if (rad && rad.value) s.radiusMeters = parseFloat(rad.value) || 50;

        const next = current._stops.slice(); next[stopIndex] = s;
        const updated = Object.assign({}, current._raw); setStops(updated, next);
        await set(dbRef(getFirebase().db, ROOT + "/" + current.id), updated); // harmless if DB node absent
        current._raw = updated; current._stops = next;
        const msg = $("metaMsg"); if (msg) msg.textContent = "Saved ✓";
      }catch(e){
        const msg = $("metaMsg"); if (msg) msg.textContent = (e && (e.message || e));
      }
    };
  }

  const del = $("deleteScenario");
  if (del){
    del.onclick = async function(){
      if (!current) return;
      if (!confirm("Delete this scenario and its cloud images?")) return;
      try{
        showLoad(true);
        await ensureAuthed();
        const paths = [];
        const st = current._stops || [];
        for (const s of st){ if (s.storagePath) paths.push(s.storagePath); if (s.gsUri) paths.push(s.gsUri); }
        for (const p of paths){ try { await deleteObject(stRef(getFirebase().storage, toStorageRefString(p))); } catch (_e){} }
        await remove(dbRef(getFirebase().db, ROOT + "/" + current.id));
        current = null; stopIndex = -1; populateScenarios(); const sel=$("scenarioSel"); if (sel) sel.value = "";
        const tr = $("thumbRow"); if (tr) tr.innerHTML = "";
        if (f){ f.clear(); baseImage=null; fitCanvas(); }
        setStatus("Scenario deleted.");
      }catch(e){ showError("Delete failed: " + (e && (e.message || e))); }
      finally{ showLoad(false); }
    };
  }

  const refresh = $("refreshBtn");
  if (refresh){
    refresh.onclick = async function(){
      await ensureAuthed();
      ROOT = FORCE_ROOT;
      const info = getStorageInfo();
      setRootPill("storage: " + ROOT + " | bucket: " + info.bucketHost);
      await loadScenarios();
      const sel = $("scenarioSel");
      if (sel && !sel.value && scenarios.length > 0){ sel.value = scenarios[0].id; sel.dispatchEvent(new Event("change")); }
    };
  }
}

/* ----------------- load & boot ----------------- */
async function loadScenarios(){
  await ensureAuthed();
  setStatus("Loading scenarios from storage…");

  const ids = await listScenarioIdsFromStorage(ROOT);
  scenarios = ids.map(id => ({ id, title: id, createdAt: 0, _raw: { id, title: id }, _stops: [] }));

  populateScenarios();
  setStatus(`${scenarios.length} scenario(s) in storage`);

  const sel = $("scenarioSel");
  if (sel && !sel.value && scenarios.length > 0){
    sel.value = scenarios[0].id;
    sel.dispatchEvent(new Event("change"));
  }
}

export async function bootScenarios(){
  try { ensureCanvas(); } catch(_e) { /* ok if fabric late */ }
  await ensureAuthed();

  ROOT = FORCE_ROOT;
  const info = getStorageInfo();
  setRootPill("storage: " + ROOT + " | bucket: " + info.bucketHost);
  await loadScenarios();

  const uid = (await ensureAuthed()).uid || "anon";
  setAuthPill("anon ✔ (" + String(uid).slice(0,8) + ")");
}

export function getCurrent(){ return current; }
export function getStopIndex(){ return stopIndex; }

const __SCENARIOS_API__ = {
  setAIStatus, setAuthPill, setStatus, setRootPill,
  isCanvasTainted, getLastLoadedBaseURL, getCompositeDataURL,
  getCurrent, getStopIndex, loadStop, hasOverlays,
  getGuideImageURLForCurrentStop, saveResultBlobToStorage, addResultAsNewStop,
  wireScenarioUI, bootScenarios
};
if (typeof window !== "undefined") window.__SCENARIOS = __SCENARIOS_API__;
export default __SCENARIOS_API__;
