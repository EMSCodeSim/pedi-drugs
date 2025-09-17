// scenarios.js — Storage-only scenario loader + advanced editor wiring
// - Auto-detects root between 'scenarios/' and 'geophoto/scenarios/'
// - Uses SDK listAll() first; if empty or errors, falls back to REST on two hosts
// - Scans one folder level deeper for images if top-level has none (e.g., thumbs/, images/, ai/results/)
// - Shows clear status + console logs

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
  setMaxOperationRetryTime,
  setMaxUploadRetryTime
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

/* ---------------- Scenario state ---------------- */
let ROOT = "scenarios"; // will be auto-detected to 'geophoto/scenarios' if present
let scenarios = [];
let current = null;
let stopIndex = -1;

/* ---------------- bucket helpers + REST fallbacks ---------------- */
function deriveBucketNames(){
  // Try to deduce both "appspot.com" and "firebasestorage.app" names
  const { app, storage } = getFirebase();
  const cfg = (app && app.options) || {};
  let sb = cfg.storageBucket || (storage && storage.bucket) || "";
  sb = String(sb).replace(/^gs:\/\//,"").replace(/\/.*/,""); // bare bucket name
  let appspot = sb.includes("appspot.com") ? sb : sb.replace("firebasestorage.app","appspot.com");
  let fsa     = sb.includes("firebasestorage.app") ? sb : sb.replace("appspot.com","firebasestorage.app");
  // If still weird, try to guess from projectId
  if (!appspot.includes(".")){
    const pid = (cfg.projectId || "").trim();
    if (pid) appspot = `${pid}.appspot.com`;
    fsa = appspot.replace("appspot.com","firebasestorage.app");
  }
  return { appspot, fsa };
}

async function getAuthBearer(){
  try{
    const u = await ensureAuthed();
    if (u && u.getIdToken) return "Bearer " + await u.getIdToken();
  }catch(_e){}
  return null;
}

async function listFoldersREST(bucketHost, rootPrefix){
  const prefix = String(rootPrefix || "").replace(/^\/+|\/+$/g, "") + "/";
  const url = "https://firebasestorage.googleapis.com/v0/b/" +
              encodeURIComponent(bucketHost) +
              "/o?delimiter=%2F&prefix=" + encodeURIComponent(prefix);
  const hdrs = { "Accept": "application/json" };
  const bearer = await getAuthBearer();
  if (bearer) hdrs["Authorization"] = bearer;
  const r = await fetch(url, { headers: hdrs, cache: "no-store" });
  if (!r.ok){
    const txt = await r.text().catch(()=> "");
    throw new Error("REST " + bucketHost + " → " + r.status + " " + txt.slice(0,200));
  }
  const j = await r.json();
  const prefixes = Array.isArray(j.prefixes) ? j.prefixes : [];
  return prefixes.map(p => p.replace(prefix, "").replace(/\/$/, "")).filter(Boolean);
}

async function listScenarioIdsFromStorage(root) {
  const { storage } = getFirebase();
  const clean = String(root || "").replace(/^\/+|\/+$/g, "");
  setStatus(`Listing '${clean}/'… (SDK)`);
  try {
    const res = await listAll(stRef(storage, clean));
    const ids = (res.prefixes || []).map(p => p.name);
    log("SDK listAll prefixes:", ids);
    if (ids.length > 0) return ids;

    // If SDK gave 0, try REST both hosts
    setStatus("No folders via SDK. Trying REST…");
  } catch (e) {
    warn("SDK listAll failed:", e?.message || e);
    setStatus("SDK list failed. Trying REST…");
  }

  const { appspot, fsa } = deriveBucketNames();
  log("REST buckets:", { appspot, fsa });

  // Try firebasestorage.app first, then appspot.com
  try {
    setStatus(`REST listing on ${fsa}…`);
    const ids = await listFoldersREST(fsa, clean);
    if (ids.length) return ids;
  } catch (e) {
    warn("REST fsa failed:", e?.message || e);
  }
  try {
    setStatus(`REST listing on ${appspot}…`);
    const ids = await listFoldersREST(appspot, clean);
    if (ids.length) return ids;
  } catch (e) {
    warn("REST appspot failed:", e?.message || e);
    showError("Storage list error under '" + root + "': " + (e?.message || e));
  }

  setStatus("No scenario folders found under '" + clean + "/'.");
  return [];
}

/* ---------------- stops from Storage (with 1-level-deep scan) ---------------- */
async function ensureStopsForCurrentFromStorage() {
  if (!current || (current._stops && current._stops.length)) return;

  setStatus("Loading photos from storage…");
  const { storage } = getFirebase();

  // Helper: list images in a folder and optionally 1 level deeper
  async function listImagesUnder(prefixPath, recurseOneLevel) {
    const out = [];
    const baseRef = stRef(storage, prefixPath.replace(/\/+/g,"/"));

    let listing;
    try {
      listing = await listAll(baseRef);
    } catch (e) {
      showError("Cannot list folder: " + (e && (e.message || e)));
      return out;
    }

    // Top-level items
    const top = (listing.items || []).filter(r => /\.(jpe?g|png|webp)$/i.test(r.name));
    for (const r of top) {
      try {
        const url = await getDownloadURL(r);
        out.push({ type:"photo", title:r.name, storagePath:r.fullPath, imageURL:url, radiusMeters:50 });
      } catch (_) {}
    }

    if (out.length || !recurseOneLevel) return out;

    // One level deeper if nothing found at top-level
    const folders = listing.prefixes || [];
    for (const p of folders) {
      try {
        const inner = await listAll(p);
        for (const r of (inner.items || [])) {
          if (!/\.(jpe?g|png|webp)$/i.test(r.name)) continue;
          try {
            const url = await getDownloadURL(r);
            out.push({ type:"photo", title:r.name, storagePath:r.fullPath, imageURL:url, radiusMeters:50 });
          } catch (_) {}
        }
      } catch (_) {}
    }
    return out;
  }

  // Try top-level; if empty, try one level deeper
  const basePath = `${ROOT}/${current.id}`;
  let stops = await listImagesUnder(basePath, /*recurseOneLevel=*/false);
  if (!stops.length) stops = await listImagesUnder(basePath, /*recurseOneLevel=*/true);

  // Sort by filename naturally
  stops.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));

  current._stops = stops;
  setStops(current._raw, current._stops);
  renderThumbs();
  setStatus(`${current._stops.length} photo(s)`);
}

/* ---------------- thumbs + stop loading ---------------- */
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

  // overlays (if any)
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

/* ---------------- basic overlay shelf + tools ---------------- */
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
      await detectAndLoadRoot(); // re-run detection on refresh
    };
  }

  wireViewerControls();
  wireOverlayShelf();
  wireBrushes();
  wireTextTools();
  wireSelectionTools();
  wireExportAndSave();
}

/* ---------------- detection + boot ---------------- */
async function detectAndLoadRoot(){
  const candidates = ["scenarios", "geophoto/scenarios"];
  let ids = [];
  for (const cand of candidates) {
    setStatus(`Probing '${cand}/'…`);
    try { ids = await listScenarioIdsFromStorage(cand); } catch(_e){ ids = []; }
    if (ids.length) { ROOT = cand; break; }
  }
  if (!ids.length) {
    ROOT = candidates[0]; // default to 'scenarios'
    ids = await listScenarioIdsFromStorage(ROOT);
  }

  const info = getStorageInfo();
  setRootPill(`storage: ${ROOT} | bucket: ${info.bucketHost || "?"}`);

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
  fitCanvas();
  await ensureAuthed();

  // Make SDK a bit more tolerant
  try {
    const { storage } = getFirebase();
    setMaxOperationRetryTime(storage, 60000);
    setMaxUploadRetryTime(storage, 60000);
  } catch(_e){}

  await detectAndLoadRoot();

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
