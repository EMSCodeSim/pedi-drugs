v// scenarios.js — Storage-only scenario loader (SDK + REST fallback) + editor wiring
// - Lists 'scenarios/' via SDK listAll; if it times out, falls back to REST
// - Deep-scans inside each scenario up to depth=3; per-folder, tries SDK then REST
// - Skips ai/, results/, overlays/, masks/; picks *.jpg|jpeg|png|webp
// - No use of setMaxOperationRetryTime (not exported by ESM CDN)

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
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ---------------- tiny DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);
const errbarEl = () => $("errbar");
const log  = (...a) => { try{ console.log("[scenarios]", ...a); }catch(_e){}; };
const warn = (...a) => { try{ console.warn("[scenarios]", ...a); }catch(_e){}; };

export function setAuthPill(t){ const el=$("authPill"); if (el) el.textContent="Auth: "+t; }
export function setStatus(t){ const el=$("statusPill"); if (el){ el.textContent=t; } log(t); }
export function setRootPill(t){ const el=$("rootPill"); if (el) el.textContent=t; }
export function setAIStatus(t){ const el=$("aiMsg"); if (el) el.textContent=t; }

export function showError(msg){
  const b = errbarEl(); if (!b) return;
  b.style.display = "block";
  b.textContent = String(msg);
  warn(msg);
}
export function hideError(){ const b = errbarEl(); if (b) b.style.display = "none"; }
function showLoad(on){ const ld=$("loader"); if (ld) ld.style.display = on ? "grid" : "none"; }

function setExportEnabled(on){
  for (const id of ["exportPNG","saveImage"]){
    const btn = $(id); if (btn) btn.disabled = !on;
  }
}

/* ---------------- Fabric canvas ---------------- */
export const f = new fabric.Canvas("c", { backgroundColor:"#061621", preserveObjectStacking:true });
let baseImage = null;
let baseTainted = false;
let lastBaseURL = null;

export function isCanvasTainted(){ return !!baseTainted; }
export function getLastLoadedBaseURL(){ return lastBaseURL; }

async function blobFromURL(url, timeoutMs){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs || 15000);
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

async function setBaseFromBlob(blob){
  baseTainted = false;
  return await new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(blob);
    fabric.Image.fromURL(url, function(img){
      URL.revokeObjectURL(url);
      if (!img) { reject(new Error("img-null")); return; }
      baseImage = img; img.set({ selectable:false, evented:false, erasable:false });
      f.clear(); f.add(img); img.moveTo(0); fitCanvas(); f.requestRenderAll();
      setExportEnabled(true);
      const info = $("canvasInfo");
      if (info) info.textContent = `Base image: ${img.width}×${img.height}`;
      resolve({ naturalW: img.width, naturalH: img.height });
    }, { crossOrigin: "anonymous" });
  });
}

export function setBaseAsTextSlide(text, fontSize){
  f.clear();
  const rect = new fabric.Rect({ left:0, top:0, width:f.getWidth(), height:f.getHeight(), fill:"#000", selectable:false, evented:false, erasable:false });
  baseImage = rect;

  const tb = new fabric.Textbox(text || "", {
    width: Math.floor(f.getWidth() * 0.8),
    left:  Math.floor(f.getWidth() * 0.1),
    top:   Math.floor(f.getHeight() * 0.2),
    fontSize: fontSize || 34, fill: "#fff", textAlign: "center",
    fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif",
    selectable:false, evented:false, erasable:false
  });
  tb.isBaseText = true;

  f.add(rect); f.add(tb); rect.moveTo(0); f.requestRenderAll();
  const info = $("canvasInfo"); if (info) info.textContent = "Text slide";
  baseTainted = false; lastBaseURL = "data:text/plain;base64," + btoa(text || "");
  setExportEnabled(true);
}

export function fitCanvas(){
  const cEl = $("c"); if (!cEl) return;
  const wrap = cEl.parentElement;
  const maxW = wrap.clientWidth - 8;
  const maxH = wrap.clientHeight - 8;
  const targetW = Math.max(320, Math.floor(maxW));
  const targetH = Math.max(240, Math.floor(maxH));
  f.setWidth(targetW);
  f.setHeight(targetH);
  if (baseImage){
    const bw = baseImage.width || 1, bh = baseImage.height || 1;
    const scale = Math.min(targetW / bw, targetH / bh);
    baseImage.set({ scaleX: scale, scaleY: scale, left: (targetW - bw*scale)/2, top: (targetH - bh*scale)/2 });
    f.requestRenderAll();
  }
}

/* ---------------- Storage REST helpers (fallback) ---------------- */
function deriveBucketNames(){
  const { app, storage } = getFirebase();
  const cfg = (app && app.options) || {};
  let sb = cfg.storageBucket || (storage && storage.bucket) || "";
  sb = String(sb).replace(/^gs:\/\//,"").replace(/\/.*/,"");
  // normalize both host variants
  const appspot = sb.includes("appspot.com") ? sb : (sb ? `${sb.replace(/\.firebasestorage\.app$/,"")}.appspot.com` : "");
  const fsa     = sb.includes("firebasestorage.app") ? sb : (sb ? `${sb.replace(/\.appspot\.com$/,"")}.firebasestorage.app` : "");
  return { appspot, fsa };
}

async function getAuthBearer(){
  try{
    const u = await ensureAuthed();
    if (u && u.getIdToken) return "Bearer " + await u.getIdToken();
  }catch(_e){}
  return null;
}

function ensurePrefixSlash(p){
  const s = String(p || "").replace(/^\/+/,"");
  return s.endsWith("/") ? s : (s + "/");
}

async function listFolderREST(bucketHost, prefixPath){
  // Single-level list using REST (delimiter=/)
  const prefix = ensurePrefixSlash(prefixPath);
  const url = "https://firebasestorage.googleapis.com/v0/b/" +
              encodeURIComponent(bucketHost) +
              "/o?delimiter=%2F&prefix=" + encodeURIComponent(prefix);
  const hdrs = { "Accept": "application/json" };
  const bearer = await getAuthBearer();
  if (bearer) hdrs["Authorization"] = bearer;
  const r = await fetch(url, { headers: hdrs, cache: "no-store" });
  if (!r.ok){
    const txt = await r.text().catch(()=> "");
    throw new Error(`REST ${bucketHost} → ${r.status} ${txt.slice(0,200)}`);
  }
  const j = await r.json();
  const prefixes = Array.isArray(j.prefixes) ? j.prefixes.map(x => x.replace(/\/$/,"")) : [];
  const items    = Array.isArray(j.items)    ? j.items.map(x => ({ name: x.name }))    : [];
  return { prefixes, items };
}

async function listFolderCombined(prefixPath){
  // Try SDK listAll first; on failure, try REST (both hosts)
  const { storage } = getFirebase();
  const norm = String(prefixPath || "").replace(/^\/+/,"").replace(/\/+$/,"");
  const ref = stRef(storage, norm);

  try {
    const res = await listAll(ref);
    const prefixes = (res.prefixes || []).map(p => (norm ? `${norm}/${p.name}` : p.name));
    const items    = (res.items || []).map(it => ({ name: it.fullPath || (norm ? `${norm}/${it.name}` : it.name) }));
    return { prefixes, items };
  } catch (e) {
    warn("SDK listAll failed at", norm || "(root)", e?.message || e);
  }

  // REST fallbacks
  const { appspot, fsa } = deriveBucketNames();
  let err1 = null, err2 = null;

  if (fsa) {
    try { return await listFolderREST(fsa, norm); } catch(e){ err1 = e; warn("REST fsa failed:", e?.message || e); }
  }
  if (appspot) {
    try { return await listFolderREST(appspot, norm); } catch(e){ err2 = e; warn("REST appspot failed:", e?.message || e); }
  }
  // Throw most recent error
  throw new Error((err2 || err1 || new Error("list failed")).message || "list failed");
}

/* ---------------- Scenario state ---------------- */
const FORCE_ROOT = "scenarios"; // fixed Storage root (cloud storage only)
let ROOT = FORCE_ROOT;

let scenarios = [];
let current = null;
let stopIndex = -1;

/* ---------------- list scenarios from Storage (with fallback) ---------------- */
async function listScenarioIdsFromStorage(root) {
  const clean = String(root || "").replace(/^\/+|\/+$/g, "");
  setStatus(`Listing '${clean}/'…`);

  try {
    const { prefixes } = await listFolderCombined(clean);
    const ids = (prefixes || []).map(full => full.replace(/^scenarios\/?/,"")).filter(Boolean);
    log("Scenario folders:", ids);
    return ids;
  } catch (e) {
    showError("Storage list error under '" + clean + "': " + (e?.message || e));
    return [];
  }
}

/* ---------------- stop discovery: deep scan (SDK+REST per folder) ---------------- */
const IMAGE_RX = /\.(jpe?g|png|webp)$/i;
const SKIP_FOLDER_RX = /^(ai|results|overlays|masks)$/i;
const MAX_COLLECT = 500; // safety cap

async function listImagesDeep(prefixPath, maxDepth){
  const out = [];
  const queue = [{ path: String(prefixPath || "").replace(/\/+$/,""), depth: 0 }];
  let scanned = 0;

  while (queue.length) {
    const { path, depth } = queue.shift();
    scanned++;
    setStatus(`Scanning ${path}/ (depth ${depth})… found ${out.length} so far`);

    let listing;
    try {
      listing = await listFolderCombined(path);
    } catch (e) {
      warn("list failed at", path, e?.message || e);
      continue;
    }

    // Items at this level
    for (const it of (listing.items || [])) {
      const full = it.name || "";
      const name = full.split("/").pop() || "";
      if (IMAGE_RX.test(name)) out.push(full);
      if (out.length >= MAX_COLLECT) break;
    }
    if (out.length >= MAX_COLLECT) break;

    // Descend to subfolders
    if (depth < maxDepth) {
      for (const p of (listing.prefixes || [])) {
        const leaf = p.split("/").pop() || "";
        if (SKIP_FOLDER_RX.test(leaf)) continue;
        queue.push({ path: p, depth: depth + 1 });
      }
    }
  }

  log("Scanned folders:", scanned, "Collected files:", out.length);
  return out;
}

async function ensureStopsForCurrentFromStorage() {
  if (!current || (current._stops && current._stops.length)) return;

  const basePath = `${ROOT}/${current.id}`;
  setStatus(`Looking for photos under '${basePath}/'…`);

  // Deep scan up to 3 levels using combined (SDK+REST) listing
  let filePaths = await listImagesDeep(basePath, 3);

  if (!filePaths.length) {
    setStatus("No images found in storage for this scenario.");
    current._stops = [];
    renderThumbs();
    return;
  }

  setStatus(`Found ${filePaths.length} file(s). Fetching URLs…`);
  // Sort for nice ordering
  filePaths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  // Parallelize getDownloadURL with small concurrency
  const { storage } = getFirebase();
  const stops = new Array(filePaths.length);
  let i = 0;
  const conc = Math.min(6, filePaths.length);

  async function worker(){
    while (true) {
      const idx = i++;
      if (idx >= filePaths.length) break;
      const fullPath = filePaths[idx];
      try {
        const url = await getDownloadURL(stRef(storage, fullPath));
        const title = fullPath.split("/").pop() || "photo";
        stops[idx] = { type:"photo", title, storagePath:fullPath, imageURL:url, radiusMeters:50 };
      } catch (e) {
        warn("getDownloadURL failed:", fullPath, e?.message || e);
        stops[idx] = null;
      }
      if (idx % 10 === 0) setStatus(`Fetching URLs… ${idx+1}/${filePaths.length}`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));

  current._stops = stops.filter(Boolean);
  setStops(current._raw, current._stops);
  renderThumbs();
  setStatus(`${current._stops.length} photo(s)`);

  // Auto-load first image
  if (current._stops.length > 0) {
    try { await loadStop(0); } catch(_) {}
  }
}

/* ---------------- populate UI ---------------- */
function setStops(sc, stops){
  const next = Object.assign({}, sc || {});
  next.stops = Array.isArray(stops) ? stops.slice() : [];
  next.photos = undefined; next.images = undefined;
  current._raw = next;
  current._stops = next.stops;
}

function populateScenarios(){
  const sel = $("scenarioSel");
  if (!sel) return;
  sel.innerHTML = '<option value="">Select scenario…</option>';
  for (const sc of scenarios){
    const o = document.createElement("option");
    o.value = sc.id;
    o.textContent = sc.title || sc.id;
    sel.appendChild(o);
  }
}

function dataURLFromStored(stored){
  if (typeof stored === "string") return stored;
  if (stored && stored.data) return "data:image/" + (stored.format || "jpeg") + ";base64," + stored.data;
  return "";
}

function renderThumbs(){
  const row = $("thumbRow");
  if (!row) return;
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

/* ---------------- stop load + overlays ---------------- */
export async function loadStop(i){
  hideError();
  if (!current) return;
  const s = current._stops[i];
  if (!s) return;
  stopIndex = i;

  const row = $("thumbRow");
  if (row){
    const kids = Array.from(row.children);
    for (let k=0;k<kids.length;k++) kids[k].classList.toggle("active", k===i);
  }

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
  } finally {
    showLoad(false);
  }

  if (Array.isArray(s.overlays)) {
    for (let k=0;k<s.overlays.length;k++){
      const ov = s.overlays[k];
      if (ov && ov.type === "text"){
        const tb = new fabric.Textbox(ov.text || "", {
          left: ov.left || 0, top: ov.top || 0, width: ov.width || Math.floor(f.getWidth() * 0.5),
          fontSize: ov.fontSize || 24, fill: ov.fill || "#fff",
          backgroundColor: ov.backgroundColor || "rgba(0,0,0,0.6)", padding: (ov.padding != null ? ov.padding : 8),
          cornerStyle:"circle", transparentCorners:false, editable:true
        });
        tb._kind = "text"; f.add(tb);
      } else if (ov && ov.src){
        await new Promise((res)=>{
          fabric.Image.fromURL(ov.src, function(img){
            img.set({
              left: ov.left || 0, top: ov.top || 0, scaleX: ov.scaleX || 1, scaleY: ov.scaleY || 1,
              angle: ov.angle || 0, opacity: (ov.opacity != null ? ov.opacity : 1),
              flipX: !!ov.flipX, flipY: !!ov.flipY,
              erasable: true, cornerStyle:"circle", transparentCorners:false
            });
            img._kind = "overlay"; f.add(img); res();
          }, { crossOrigin: "anonymous" });
        });
      }
    }
  }
  f.requestRenderAll();
}

/* ---------------- Guide / Export helpers for AI uploader ---------------- */
async function getBlobSDKFirst(refLike, timeoutMs){
  try{
    const { storage } = getFirebase();
    const ref = stRef(storage, toStorageRefString(refLike));
    const blob = await withTimeout(storageGetBlob(ref), timeoutMs || 20000, "storage/getblob-timeout");
    return blob;
  }catch(_e){
    try{
      const url = /^https?:\/\//i.test(refLike) ? refLike : await getDownloadURL(stRef(getFirebase().storage, toStorageRefString(refLike)));
      const blob = await withTimeout(blobFromURL(url, 15000), timeoutMs || 20000, "fetch-timeout");
      baseTainted = true;
      return blob;
    }catch(e2){
      throw e2;
    }
  }
}

async function resolveForStop(stop, timeoutMs){
  const seeds = [
    stop.imageURL,
    stop.gsUri,
    stop.storagePath,
    stop.thumbURL,
    stop && stop.imageData && stop.imageData.data
      ? "data:image/" + (stop.imageData.format || "jpeg") + ";base64," + stop.imageData.data
      : null
  ].filter(Boolean);

  const extras = [];
  if (seeds.length){
    for (let i=0;i<seeds.length;i++){
      const cands = candidateOriginals(seeds[i]).slice(0, 6);
      for (let j=0;j<cands.length;j++) extras.push(cands[j]);
    }
  }

  const tried = new Set();
  for (let i=0;i<seeds.length;i++){
    const s = seeds[i]; if (tried.has(s)) continue; tried.add(s);
    try{ const bl = await getBlobSDKFirst(s, timeoutMs); lastBaseURL = s; return bl; }catch(_e){}
  }
  for (let i=0;i<extras.length;i++){
    const s = extras[i]; if (tried.has(s)) continue; tried.add(s);
    try{ const bl = await getBlobSDKFirst(s, timeoutMs); lastBaseURL = s; return bl; }catch(_e){}
  }
  throw new Error("Could not resolve image for stop.");
}

export async function getGuideImageURLForCurrentStop(){
  if (!current || stopIndex < 0) throw new Error("No stop selected");
  const s = current._stops[stopIndex];

  if (lastBaseURL && (/^https?:\/\//i.test(lastBaseURL) || lastBaseURL.startsWith("data:") || lastBaseURL.startsWith("blob:"))) {
    return lastBaseURL;
  }
  if (s && s.imageURL && /^https?:\/\//i.test(s.imageURL)) return s.imageURL;

  const refLike = s.gsUri || s.storagePath || s.thumbURL || s.imageURL;
  if (refLike){
    const { storage } = getFirebase();
    const r = stRef(storage, toStorageRefString(refLike));
    return await getDownloadURL(r);
  }
  if (s && s.imageData && s.imageData.data){
    return "data:image/" + (s.imageData.format || "jpeg") + ";base64," + s.imageData.data;
  }
  throw new Error("This stop has no accessible base image.");
}

export function hasOverlays(){
  return f.getObjects().some(o => o && !o.isBaseText && o !== baseImage);
}

export function getCompositeDataURL(){
  if (baseTainted) return null;
  try{ return f.toDataURL({ format:"png", quality: 0.92, multiplier: 1 }); }
  catch(_e){ return null; }
}

export async function saveResultBlobToStorage(blob){
  if (!current || stopIndex < 0) throw new Error("No stop selected");
  const { storage } = getFirebase();
  const ts = Date.now();
  const path = `${ROOT}/${current.id}/ai/results/${ts}_stop${stopIndex}.jpg`;
  const ref = stRef(storage, path);

  await new Promise((resolve, reject)=>{
    const task = uploadBytesResumable(ref, blob, { contentType:"image/jpeg", cacheControl:"public,max-age=31536000,immutable" });
    const t = setTimeout(function(){ try{ task.cancel(); }catch(_e){}; reject(Object.assign(new Error("upload/timeout"),{code:"upload/timeout"})); }, 90000);
    task.on("state_changed", function(){}, function(err){ clearTimeout(t); reject(err); }, function(){ clearTimeout(t); resolve(); });
  });
  return await getDownloadURL(ref);
}

export async function addResultAsNewStop(url){
  if (!current || stopIndex < 0) return;
  const base = current._stops[stopIndex];
  const newStop = {
    type: "photo",
    title: (base.title || "") + " (AI)",
    caption: "AI composite",
    imageURL: url,
    storagePath: null,
    radiusMeters: base.radiusMeters || 50,
    lat: base.lat, lng: base.lng
  };
  const next = current._stops.slice(); next.push(newStop);
  const updated = Object.assign({}, current._raw); setStops(updated, next);

  try{ await set(dbRef(getFirebase().db, ROOT + "/" + current.id), updated); }catch(_e){}
  renderThumbs();
}

/* ---------------- overlay shelf + tools ---------------- */
async function fetchOverlayList(folder){
  try{
    const r = await fetch("https://fireopssim.com/geophoto/overlays/index.json", { cache:"force-cache" });
    if (r.ok){
      const j = await r.json();
      if (j && Array.isArray(j[folder])) {
        const base = "https://fireopssim.com/geophoto/overlays/" + folder + "/";
        return j[folder].map(name => base + name);
      }
    }
  }catch(_e){}
  const base = "https://fireopssim.com/geophoto/overlays/" + folder + "/";
  return [1,2,3,4,5].map(n => base + n + ".png");
}

function wireOverlayShelf(){
  const shelf = $("overlayShelf");
  if (!shelf) return;
  shelf.innerHTML = "";

  const groups = [
    { title:"Smoke", key:"smoke" },
    { title:"Fire", key:"fire" },
    { title:"People", key:"people" },
    { title:"Vehicles", key:"vehicles" }
  ];

  for (const grp of groups){
    const h = document.createElement("h4"); h.textContent = grp.title; h.style.margin="8px 0 4px"; h.style.color="#9fb0c0";
    shelf.appendChild(h);

    const row = document.createElement("div"); row.style.display="flex"; row.style.flexWrap="wrap"; row.style.gap="6px"; shelf.appendChild(row);
    (function(row, grp){
      fetchOverlayList(grp.key).then(urls=>{
        for (let i=0;i<urls.length;i++){
          const u = urls[i];
          const img = document.createElement("img"); img.src=u; img.alt=grp.key + " " + (i+1);
          img.style.width="60px"; img.style.height="60px"; img.style.objectFit="contain"; img.style.background="#0c121a"; img.style.borderRadius="8px"; img.style.cursor="grab";
          img.onclick = function(){
            fabric.Image.fromURL(u, function(o){
              o.set({ left:10, top:10, opacity:1, erasable:true, cornerStyle:"circle", transparentCorners:false });
              o._kind = "overlay";
              f.add(o); f.setActiveObject(o); f.requestRenderAll();
            }, { crossOrigin:"anonymous" });
          };
          row.appendChild(img);
        }
      });
    })(row, grp);
  }
}

function wireBrushes(){
  const b = $("brushSize"); const e = $("eraserSize");
  if (b){ b.oninput = function(){ const v=+b.value||10; f.isDrawingMode = true; f.freeDrawingBrush = new fabric.PencilBrush(f); f.freeDrawingBrush.width = v; }; }
  if (e){ e.oninput = function(){ const v=+e.value||24; f.isDrawingMode = true; f.freeDrawingBrush = new fabric.EraserBrush(f); f.freeDrawingBrush.width = v; }; }
  const pan = $("panMode"); if (pan){ pan.onclick = function(){ f.isDrawingMode = false; }; }
}

function wireTextTools(){
  const add = $("addText");
  if (add){
    add.onclick = function(){
      const tb = new fabric.Textbox("Text", { left:20, top:20, width: Math.floor(f.getWidth()*0.4),
        fill:"#fff", backgroundColor:"rgba(0,0,0,0.6)", padding:8, cornerStyle:"circle", transparentCorners:false, editable:true });
      tb._kind = "text";
      f.add(tb); f.setActiveObject(tb); f.requestRenderAll();
    };
  }
}

function wireSelectionTools(){
  const del = $("deleteSel");
  if (del){ del.onclick = function(){ const a = f.getActiveObject(); if (a) f.remove(a); }; }
}

function wireExportAndSave(){
  const exportBtn = $("exportPNG");
  if (exportBtn){
    exportBtn.onclick = async function(){
      try{
        if (baseTainted) { showError("Canvas is tainted; export disabled. (AI still works.)"); return; }
        const data = getCompositeDataURL();
        if (!data) { showError("Export failed."); return; }
        const a = document.createElement("a");
        a.href = data; a.download = (current ? current.id : "scene") + "_stop" + stopIndex + ".png"; a.click();
      }catch(e){ showError(e && (e.message || e)); }
    };
  }

  const saveBtn = $("saveImage");
  if (saveBtn){
    saveBtn.onclick = async function(){
      try{
        if (baseTainted){ showError("Canvas is tainted; cannot save."); return; }
        if (!current || stopIndex < 0) { showError("No stop selected."); return; }
        const data = getCompositeDataURL();
        if (!data) { showError("No data to save."); return; }
        const blob = await (await fetch(data)).blob();
        const url = await saveResultBlobToStorage(blob);
        setStatus("Saved to: " + url);
      }catch(e){ showError(e && (e.message || e)); }
    };
  }
}

/* ---------------- UI wiring + boot ---------------- */
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

  const sel = $("scenarioSel");
  if (sel){
    sel.onchange = async function(){
      const id = sel.value;
      current = scenarios.find(s => s.id === id) || null;
      stopIndex = -1;
      renderThumbs();
      f.clear(); baseImage = null; fitCanvas();
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
        const lat = $("stopLat"); if (lat) lat.value = p.coords.latitude.toFixed(6);
        const lng = $("stopLng"); if (lng) lng.value = p.coords.longitude.toFixed(6);
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
        const title = $("stopTitle"); if (title) s.title = title.value || "";
        const cap   = $("stopCaption"); if (cap) s.caption = cap.value || "";
        const lat   = $("stopLat"); if (lat && lat.value) s.lat = parseFloat(lat.value);
        const lng   = $("stopLng"); if (lng && lng.value) s.lng = parseFloat(lng.value);
        const rad   = $("stopRadius"); if (rad && rad.value) s.radiusMeters = parseFloat(rad.value) || 50;

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
        for (let i=0;i<st.length;i++){
          const s = st[i];
          if (s.storagePath) paths.push(s.storagePath);
          if (s.gsUri) paths.push(s.gsUri);
        }
        for (let i=0;i<paths.length;i++){
          try { await deleteObject(stRef(getFirebase().storage, toStorageRefString(paths[i]))); } catch (_e){}
        }
        await remove(dbRef(getFirebase().db, ROOT + "/" + current.id));
        current = null; stopIndex = -1; populateScenarios(); if (sel) sel.value = "";
        const tr = $("thumbRow"); if (tr) tr.innerHTML = "";
        f.clear(); baseImage = null; fitCanvas();
        setStatus("Scenario deleted.");
      }catch(e){
        showError("Delete failed: " + (e && (e.message || e)));
      }finally{
        showLoad(false);
      }
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
      if (sel && !sel.value && scenarios.length > 0){
        sel.value = scenarios[0].id;
        sel.dispatchEvent(new Event("change"));
      }
    };
  }

  wireViewerControls();
  wireOverlayShelf();
  wireBrushes();
  wireTextTools();
  wireSelectionTools();
  wireExportAndSave();
}

/* ---------------- boot ---------------- */
async function loadScenarios(){
  await ensureAuthed();
  setStatus("Loading scenarios from storage…");

  const ids = await listScenarioIdsFromStorage(ROOT);
  scenarios = ids.map(id => ({ id, title: id, createdAt: 0, _raw: { id, title: id }, _stops: [] }));

  populateScenarios();
  setStatus(`${scenarios.length} scenario(s) in storage`);

  // Auto-select first scenario to kick off discovery
  const sel = $("scenarioSel");
  if (sel && !sel.value && scenarios.length > 0){
    sel.value = scenarios[0].id;
    sel.dispatchEvent(new Event("change"));
  }
}

export async function bootScenarios(){
  fitCanvas();
  await ensureAuthed();

  ROOT = FORCE_ROOT;
  const info = getStorageInfo();
  setRootPill("storage: " + ROOT + " | bucket: " + info.bucketHost);
  await loadScenarios();

  const uid = (await ensureAuthed()).uid || "anon";
  setAuthPill("anon ✔ (" + String(uid).slice(0,8) + ")");
}

/* ---------------- expose API ---------------- */
function wireViewerControls(){
  const info = $("canvasInfo");
  window.addEventListener("resize", fitCanvas);
  if (info) info.textContent = "Canvas ready.";
}
export function getCurrent(){ return current; }
export function getStopIndex(){ return stopIndex; }

const __SCENARIOS_API__ = {
  setAIStatus, setAuthPill, setStatus, setRootPill,
  f, isCanvasTainted, getLastLoadedBaseURL, getCompositeDataURL,
  getCurrent, getStopIndex, loadStop, hasOverlays,
  getGuideImageURLForCurrentStop, saveResultBlobToStorage, addResultAsNewStop,
  wireScenarioUI, bootScenarios
};
if (typeof window !== "undefined") window.__SCENARIOS = __SCENARIOS_API__;
export default __SCENARIOS_API__;
