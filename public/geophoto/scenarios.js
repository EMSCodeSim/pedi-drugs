// scenarios.js — robust scenario loader + editor wiring (no syntax gotchas)

import {
  getFirebase,
  ensureAuthed,
  getStorageInfo,
  toStorageRefString,
  candidateOriginals,
  detectScenariosRoot
} from "./firebase-core.js";

import {
  ref as dbRef,
  get,
  set,
  remove,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

import {
  ref as stRef,
  getDownloadURL,
  getBlob as storageGetBlob,
  uploadBytesResumable,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ---------------- DOM helpers & status ---------------- */
function $(id){ return document.getElementById(id); }
const errbarEl = () => $("errbar");

export function setAuthPill(text){ const el=$("authPill"); if (el) el.textContent = "Auth: " + text; }
export function setStatus(text){ const el=$("statusPill"); if (el) el.textContent = text; }
export function setRootPill(text){ const el=$("rootPill"); if (el) el.textContent = text; }
export function setAIStatus(text){ const el=$("aiMsg"); if (el) el.textContent = text; }

export function showError(msg){
  const b = errbarEl(); if (!b) return;
  b.style.display = "block";
  b.textContent = String(msg);
  console.error("[scenarios] ", msg);
}
export function hideError(){ const b = errbarEl(); if (b) b.style.display = "none"; }
export function showLoad(on){ const l=$("loader"); if (l) l.style.display = on ? "grid" : "none"; }

function setExportEnabled(on){
  const ids = ["exportPNG","saveImage"];
  for (let i=0;i<ids.length;i++){
    const btn = $(ids[i]);
    if (btn) btn.disabled = !on;
  }
}

/* ---------------- Fabric canvas ---------------- */
export const f = new fabric.Canvas("c", { backgroundColor:"#061621", preserveObjectStacking:true });
let baseImage = null;
let baseTainted = false;       // disables export/save only (AI can still run)
let lastBaseURL = null;        // the exact URL/blob/data used to load the base

export function isCanvasTainted(){ return !!baseTainted; }
export function getLastLoadedBaseURL(){ return lastBaseURL || null; }

function blobToObjectURL(bl){ return URL.createObjectURL(bl); }
function revokeURL(u){ try{ URL.revokeObjectURL(u); }catch{} }

async function setBaseFromBlob(blob){
  return new Promise((resolve, reject)=>{
    const url = blobToObjectURL(blob);
    fabric.Image.fromURL(url, function(img){
      revokeURL(url);
      if (!img) { reject(new Error("Image decode failed")); return; }
      if (baseImage) f.remove(baseImage);
      baseImage = img;
      baseImage.selectable = false;
      baseImage.evented = false;
      baseImage.set("erasable", false);

      const cw = f.getWidth(), ch = f.getHeight();
      const s = Math.min(cw/img.width, ch/img.height);
      img.scale(s);
      img.set({ left:(cw-img.width*s)/2, top:(ch-img.height*s)/2 });
      f.add(img); img.moveTo(0); f.requestRenderAll();

      const info = $("canvasInfo");
      if (info) info.textContent = `Image ${Math.round(img.width)}×${Math.round(img.height)} | shown ${Math.round(img.width*s)}×${Math.round(img.height*s)}`;

      baseTainted = false;
      setExportEnabled(true);

      if (!lastBaseURL) lastBaseURL = "blob://loaded";
      resolve({ naturalW: img.width, naturalH: img.height });
    }, { crossOrigin: "anonymous" });
  });
}

async function setBaseFromDirectURL(url){
  return new Promise((resolve, reject)=>{
    fabric.Image.fromURL(url, function(img){
      if (!img) { reject(new Error("Image decode failed")); return; }
      if (baseImage) f.remove(baseImage);
      baseImage = img;
      baseImage.selectable = false;
      baseImage.evented = false;
      baseImage.set("erasable", false);

      const cw = f.getWidth(), ch = f.getHeight();
      const s = Math.min(cw/img.width, ch/img.height);
      img.scale(s);
      img.set({ left:(cw-img.width*s)/2, top:(ch-img.height*s)/2 });
      f.add(img); img.moveTo(0); f.requestRenderAll();

      const info = $("canvasInfo");
      if (info) info.textContent = `Image (cross-origin) ${Math.round(img.width)}×${Math.round(img.height)} — export disabled`;

      baseTainted = true;
      setExportEnabled(false);
      lastBaseURL = url;

      resolve({ naturalW: img.width, naturalH: img.height });
    } /* no crossOrigin on purpose */, null);
  });
}

function setBaseAsTextSlide(text, fontSize){
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

  const info = $("canvasInfo");
  if (info) info.textContent = "Text slide";

  baseTainted = false;
  lastBaseURL = "data:text/plain;base64," + btoa(text || "");
  setExportEnabled(true);
}

export function fitCanvas(){
  const cEl = $("c");
  const targetH = Math.max(420, (window.innerHeight || 900) - 280);
  if (cEl) cEl.style.height = targetH + "px";
  f.setHeight(targetH);
  const viewer = cEl && cEl.closest ? cEl.closest(".col") : null;
  const w = (viewer && viewer.clientWidth ? viewer.clientWidth : 900) - 24;
  f.setWidth(w);
  if (baseImage && baseImage.type === "rect"){
    baseImage.set({ left:0, top:0, width:f.getWidth(), height:f.getHeight() });
  }
  f.calcOffset();
  f.requestRenderAll();
}
addEventListener("resize", fitCanvas);

/* ---------------- Image resolving ---------------- */
function withTimeout(promise, ms, label){
  return Promise.race([
    promise,
    new Promise((_, rej)=> setTimeout(()=> rej(Object.assign(new Error(label || "timeout"), { code: label || "timeout" })), ms))
  ]);
}

const FB_GAPI = /^https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/i;
const FB_APP  = /^https?:\/\/([^/]+)\.firebasestorage\.app\/o\/([^?]+)/i;

function parseFirebaseURL(url){
  let m = url.match(FB_GAPI);
  if (m) return { bucket: (m[1]||"").replace(".firebasestorage.app",".appspot.com"), object: m[2].replace(/\+/g," ") };
  m = url.match(FB_APP);
  if (m) return { bucket: (m[1]+".firebasestorage.app").replace(".firebasestorage.app",".appspot.com"), object: m[2].replace(/\+/g," ") };
  return null;
}

async function getBlobSDKFirst(refLike, timeoutMs){
  const { storage } = getFirebase();
  const s = (refLike || "").trim();
  if (!s) throw new Error("empty-ref");

  if (/^data:/i.test(s)){
    const r = await fetch(s); return await r.blob();
  }

  if (/^https?:\/\//i.test(s)){
    const parsed = parseFirebaseURL(s);
    if (parsed){
      const ref = stRef(storage, "gs://" + parsed.bucket + "/" + parsed.object);
      return await withTimeout(storageGetBlob(ref), timeoutMs || 20000, "storage/getblob-timeout");
    }
    const r = await withTimeout(fetch(s, { mode:"cors", credentials:"omit", cache:"no-store" }), timeoutMs || 20000, "fetch/timeout");
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.blob();
  }

  // bucket/path or gs://
  const ref = stRef(storage, toStorageRefString(s));
  return await withTimeout(storageGetBlob(ref), timeoutMs || 20000, "storage/getblob-timeout");
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
  for (let i=0;i<seeds.length;i++){
    const s = seeds[i];
    const cands = candidateOriginals(s);
    for (let j=0;j<cands.length;j++) extras.push(cands[j]);
  }

  const unique = new Set();
  const candidates = [];
  const pushUnique = (v) => { const k = String(v||"").trim(); if (!k || unique.has(k)) return; unique.add(k); candidates.push(k); };
  for (let i=0;i<seeds.length;i++) pushUnique(seeds[i]);
  for (let i=0;i<extras.length;i++) pushUnique(extras[i]);

  let lastPlainHTTP = null;

  for (let i=0;i<candidates.length;i++){
    const c = candidates[i];
    try {
      const bl = await getBlobSDKFirst(c, timeoutMs || 22000);
      if (bl && bl.size > 0) return { blob: bl, urlUsed: c, directFallbackUrl: null };
    } catch (e) {
      if (typeof c === "string" && /^https?:\/\//i.test(c)) lastPlainHTTP = c;
      console.warn("[resolve] candidate failed", c, e && (e.code || e.message || e));
    }
  }

  if (lastPlainHTTP) return { blob: null, urlUsed: null, directFallbackUrl: lastPlainHTTP };
  throw new Error("no-image-candidate-succeeded");
}

/* ---------------- Scenario state ---------------- */
let ROOT = "scenarios";
let scenarios = [];
let current = null;
let stopIndex = -1;

const { db } = getFirebase();

function coerceStops(sc){
  if (sc && Array.isArray(sc.stops)) return sc.stops;
  if (sc && Array.isArray(sc.photos)) return sc.photos;
  if (sc && Array.isArray(sc.images)) return sc.images;
  return [];
}
function setStops(sc, stops){
  if (sc && Array.isArray(sc.stops)) sc.stops = stops;
  else if (sc && Array.isArray(sc.photos)) sc.photos = stops;
  else if (sc && Array.isArray(sc.images)) sc.images = stops;
  else sc.stops = stops;
}

function populateScenarios(){
  const sel = $("scenarioSel");
  if (!sel) return;
  sel.innerHTML = '<option value="">Select scenario…</option>';
  for (let i=0;i<scenarios.length;i++){
    const sc = scenarios[i];
    const o = document.createElement("option");
    o.value = sc.id;
    o.textContent = (sc.title || "(untitled)") + (sc.active ? "" : " (inactive)");
    sel.appendChild(o);
  }
}

async function fetchNode(path){
  try {
    const snap = await get(dbRef(db, path));
    return snap.exists() ? (snap.val() || {}) : {};
  } catch (_e) {
    return {};
  }
}

async function loadScenarios(){
  await ensureAuthed();
  setStatus("Loading…");

  const a = await fetchNode("geophoto/scenarios");
  const b = await fetchNode("scenarios");

  const list = [];
  for (const k in a) list.push({ id:k, ...(a[k] || {}) });
  for (const k in b) list.push({ id:k, ...(b[k] || {}) });

  const uniq = new Map();
  for (let i=0;i<list.length;i++){ const x=list[i]; if (!uniq.has(x.id)) uniq.set(x.id, x); }

  const arr = Array.from(uniq.values()).sort((x,y)=> (y.createdAt||0) - (x.createdAt||0));
  scenarios = arr.map(s => ({ id:s.id, _raw:s, _stops:coerceStops(s), ...s }));

  populateScenarios();
  setStatus(scenarios.length + " scenario(s)");
}

let unsubA = null, unsubB = null;
function subscribeScenarios(){
  try{ if (typeof unsubA === "function") unsubA(); } catch (_){}
  try{ if (typeof unsubB === "function") unsubB(); } catch (_){}

  const refA = dbRef(db, "geophoto/scenarios");
  const refB = dbRef(db, "scenarios");
  const onAnyChange = function(){ loadScenarios(); };

  unsubA = onValue(refA, onAnyChange, function(){});
  unsubB = onValue(refB, onAnyChange, function(){});
}

/* ---------------- Thumbs & stop loading ---------------- */
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
    const thumbSrc = s.thumbURL || s.imageURL || dataURLFromStored(s.imageData) || "";
    const img = document.createElement("img");
    img.className = "thumb" + (i === stopIndex ? " active" : "");
    img.src = thumbSrc;
    img.alt = s.title || ("Stop " + (i+1));
    img.onerror = function(){
      img.src = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="52%" fill="#fff" font-size="14" text-anchor="middle">No image</text></svg>');
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
  const rad = $("stopRadius"); if (rad) rad.value = (s.radiusMeters != null ? s.radiusMeters : (s.radius != null ? s.radius : 50));

  f.clear(); baseImage = null;

  if (s.type === "text"){
    setBaseAsTextSlide(s.text || "", s.fontSize || 34);
    return;
  }

  try{
    showLoad(true);
    await ensureAuthed();

    const result = await resolveForStop(s, 22000);

    if (result.blob){
      lastBaseURL = result.urlUsed || lastBaseURL || null;
      await setBaseFromBlob(result.blob);
    } else if (result.directFallbackUrl){
      await setBaseFromDirectURL(result.directFallbackUrl);
      showError("Base image loaded via cross-origin fallback. Export/Save disabled for this stop.");
    } else {
      throw new Error("no-image-candidate-succeeded");
    }

    // Gentle upgrade for very small images if we can (never throws)
    const minGood = 480;
    const naturalW = baseImage ? baseImage.width : 0;
    const naturalH = baseImage ? baseImage.height : 0;
    if (!baseTainted && (naturalW < minGood && naturalH < minGood)){
      const seeds = lastBaseURL || s.imageURL || s.thumbURL || s.storagePath || s.gsUri;
      const extras = candidateOriginals(seeds).slice(0, 6);
      for (let j=0;j<extras.length;j++){
        try{
          const bl2 = await getBlobSDKFirst(extras[j], 12000);
          lastBaseURL = extras[j];
          const d2 = await setBaseFromBlob(bl2);
          if (d2.naturalW >= minGood || d2.naturalH >= minGood) break;
        } catch (_e){}
      }
    }
  } catch (e){
    if (s.imageData && s.imageData.data){
      try{
        const data = "data:image/" + (s.imageData.format || "jpeg") + ";base64," + s.imageData.data;
        lastBaseURL = data;
        const bl = await (await fetch(data)).blob();
        await setBaseFromBlob(bl);
        showError("Loaded embedded image; original not available.");
      } catch (_ee){
        showError("Image load failed for this stop.");
      }
    } else {
      showError("Image load failed for this stop.");
    }
  } finally {
    showLoad(false);
  }

  // Best-effort overlays
  if (Array.isArray(s.overlays)){
    for (let k=0;k<s.overlays.length;k++){
      const ov = s.overlays[k];
      if (ov && ov.kind === "text"){
        const tb = new fabric.Textbox(ov.text || "", {
          left: ov.left || 100, top: ov.top || 100, scaleX: ov.scaleX || 1, scaleY: ov.scaleY || 1,
          angle: ov.angle || 0, opacity: (ov.opacity != null ? ov.opacity : 1),
          fontSize: ov.fontSize || 24, fill: ov.fill || "#fff",
          backgroundColor: ov.backgroundColor || "rgba(0,0,0,0.6)", padding: (ov.padding != null ? ov.padding : 8),
          cornerStyle:"circle", transparentCorners:false, editable:true
        });
        tb._kind = "text";
        f.add(tb);
      } else if (ov && ov.src){
        await new Promise((res)=>{
          fabric.Image.fromURL(ov.src, function(img){
            img.set({
              left: ov.left || 0, top: ov.top || 0, scaleX: ov.scaleX || 1, scaleY: ov.scaleY || 1,
              angle: ov.angle || 0, opacity: (ov.opacity != null ? ov.opacity : 1),
              flipX: !!ov.flipX, flipY: !!ov.flipY,
              erasable: true, cornerStyle:"circle", transparentCorners:false
            });
            f.add(img); res();
          }, { crossOrigin: "anonymous" });
        });
      }
    }
    f.requestRenderAll();
  }
}

/* ---------------- Public API (used by ai-upload.js) ---------------- */
export async function getGuideImageURLForCurrentStop(){
  if (!current || stopIndex < 0) throw new Error("No stop selected");
  const s = current._stops[stopIndex];

  if (lastBaseURL && (/^https?:\/\//i.test(lastBaseURL) || lastBaseURL.indexOf("data:") === 0 || lastBaseURL.indexOf("blob:") === 0)) {
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
  const objs = f.getObjects();
  for (let i=0;i<objs.length;i++){
    const o = objs[i];
    if (o !== baseImage && !o.isBaseText) return true;
  }
  return false;
}

export async function getCompositeDataURL(maxEdge, quality){
  if (baseTainted) throw new Error("Canvas is cross-origin tainted; export disabled.");
  const me = (typeof maxEdge === "number" && maxEdge > 0) ? maxEdge : 1600;
  const q = (typeof quality === "number" && quality > 0 && quality <= 1) ? quality : 0.95;

  const raw = f.toDataURL({ format: "jpeg", quality: 1 });
  const img = new Image(); img.decoding = "async"; img.src = raw; await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const s = Math.min(1, me / Math.max(w, h));
  const outW = Math.round(w*s), outH = Math.round(h*s);
  const c = document.createElement("canvas"); c.width = outW; c.height = outH;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, outW, outH);
  return c.toDataURL("image/jpeg", q);
}

export async function saveResultBlobToStorage(blob){
  if (!current || stopIndex < 0) throw new Error("No stop selected");
  const { storage } = getFirebase();
  const ts = Date.now();
  const path = "scenarios/" + current.id + "/ai/results/" + ts + "_stop" + stopIndex + ".jpg";
  const ref = stRef(storage, path);

  await new Promise((resolve, reject)=>{
    const task = uploadBytesResumable(ref, blob, { contentType:"image/jpeg", cacheControl:"public,max-age=31536000,immutable" });
    const t = setTimeout(function(){ try{ task.cancel(); }catch(_e){} reject(Object.assign(new Error("upload/timeout"),{code:"upload/timeout"})); }, 90000);
    task.on("state_changed", function(){}, function(err){ clearTimeout(t); reject(err); }, function(){ clearTimeout(t); resolve(); });
  });

  return await getDownloadURL(ref);
}

export async function addResultAsNewStop(url){
  if (!current || stopIndex < 0) return;
  const base = current._stops[stopIndex];
  const ts = Date.now();
  const newStop = {
    type: "photo",
    title: (base.title || "") + " (AI)",
    caption: "AI composite",
    imageURL: url,
    thumbURL: url,
    storagePath: null,
    gsUri: null,
    lat: (base.lat != null ? base.lat : null),
    lng: (base.lng != null ? base.lng : null),
    accuracy: (base.accuracy != null ? base.accuracy : null),
    radiusMeters: (base.radiusMeters != null ? base.radiusMeters : 50),
    overlays: [],
    at: ts,
    origin: "ai",
    basedOn: stopIndex
  };
  const next = current._stops.slice(); next.push(newStop);
  const updated = Object.assign({}, current._raw);
  setStops(updated, next);
  await set(dbRef(getFirebase().db, ROOT + "/" + current.id), updated);
  current._raw = updated; current._stops = next;
  renderThumbs();
  setAIStatus("AI image added as a new stop.");
}

export function getCurrent(){ return current; }
export function getStopIndex(){ return stopIndex; }

/* ---------------- Editor tools (overlays / brushes / text / selection / export) ---------------- */
function addOverlay(src){
  fabric.Image.fromURL(src, function(img){
    const cw = f.getWidth(), ch = f.getHeight(), targetW = cw * 0.28, scale = targetW / img.width;
    img.scale(scale);
    img.set({
      left: cw/2 - (img.width*img.scaleX)/2,
      top:  ch/2 - (img.height*img.scaleY)/2,
      cornerStyle:"circle", transparentCorners:false,
      shadow:"rgba(0,0,0,0.35) 0 6px 16px", erasable:true
    });
    f.add(img); f.setActiveObject(img); f.requestRenderAll();
  }, { crossOrigin: "anonymous" });
}

async function listOverlays(cat){
  let folder = "fire";
  if (cat === "smoke") folder = "smoke";
  else if (cat === "people") folder = "people";
  else if (cat === "cars") folder = "cars";
  else if (cat === "hazard") folder = "hazard";

  try{
    const r = await fetch("https://fireopssim.com/geophoto/overlays/manifest.json", { cache:"no-store" });
    if (r.ok){
      const j = await r.json();
      if (j && Array.isArray(j[folder])) {
        const base = "https://fireopssim.com/geophoto/overlays/" + folder + "/";
        return j[folder].map(function(name){ return base + name; });
      }
    }
  }catch(_e){}

  const base = "https://fireopssim.com/geophoto/overlays/" + folder + "/";
  return [1,2,3,4,5].map(function(n){ return base + n + ".png"; });
}

function wireOverlayShelf(){
  const shelf = $("overlayShelf");
  if (!shelf) return;
  const buttons = Array.from(document.querySelectorAll("#tools [data-cat]"));

  async function render(cat){
    shelf.innerHTML = "";
    const urls = await listOverlays(cat);
    if (!urls || urls.length === 0){
      shelf.innerHTML = '<div class="pill small">No overlays found</div>';
      return;
    }
    for (let i=0;i<urls.length;i++){
      const u = urls[i];
      const cell = document.createElement("div");
      cell.style.border = "1px solid rgba(255,255,255,.14)";
      cell.style.borderRadius = "10px";
      cell.style.padding = "4px";
      cell.style.background = "#0b2130";

      const img = new Image();
      img.src = u; img.alt = "overlay"; img.style.width = "100%"; img.style.display = "block";
      img.onclick = function(){ addOverlay(u); };

      cell.appendChild(img);
      shelf.appendChild(cell);
    }
  }

  for (let i=0;i<buttons.length;i++){
    const b = buttons[i];
    b.addEventListener("click", function(){ render(b.getAttribute("data-cat")); });
  }
  render("fire");
}

function wireBrushes(){
  const btnF = $("brushFire"), btnS = $("brushSmoke"), btnE = $("brushErase"), btnOff = $("brushOff");
  const size = $("brushSize"), readout = $("brushSizeReadout");
  if (!btnF || !btnS || !btnE || !btnOff || !size) return;

  let brushMode = "off";
  let pointerDown = false;
  let lastStamp = null;

  function dist(a,b){ return Math.hypot(a.x - b.x, a.y - b.y); }

  async function randomOverlay(cat){
    const urls = await listOverlays(cat);
    if (!urls || urls.length === 0) return null;
    return urls[Math.floor(Math.random()*urls.length)];
  }

  async function stampAt(p, cat){
    const file = await randomOverlay(cat);
    if (!file) return;
    const R = (parseInt(size.value, 10) || 120) / 2;
    if (lastStamp && dist(p, lastStamp) < R*0.6) return;
    lastStamp = p;

    fabric.Image.fromURL(file, function(img){
      const baseW = img.width || 200;
      const scale  = (R*2) / baseW;
      const jitter = 0.75 + Math.random()*0.5;
      img.scale(scale * jitter);
      img.set({
        left: p.x - (img.width*img.scaleX)/2,
        top:  p.y - (img.height*img.scaleY)/2,
        angle: (Math.random()*30 - 15),
        opacity: 0.9,
        cornerStyle:"circle", transparentCorners:false,
        erasable:true, selectable:false, evented:false
      });
      f.add(img); f.requestRenderAll();
    }, { crossOrigin:"anonymous" });
  }

  function eraseStampsAt(p){
    const R = (parseInt(size.value, 10) || 120) / 2;
    const targets = f.getObjects("image").filter(function(o){ return o !== baseImage; });
    for (let i=0;i<targets.length;i++){
      const obj = targets[i];
      const cx = obj.left + (obj.width*obj.scaleX)/2;
      const cy = obj.top  + (obj.height*obj.scaleY)/2;
      if (Math.hypot(cx - p.x, cy - p.y) <= R) f.remove(obj);
    }
    f.requestRenderAll();
  }

  btnF.onclick = function(){ brushMode = "fire"; };
  btnS.onclick = function(){ brushMode = "smoke"; };
  btnE.onclick = function(){ brushMode = "erase"; };
  btnOff.onclick = function(){ brushMode = "off"; };

  if (readout) readout.textContent = (parseInt(size.value,10) || 120) + " px";
  size.oninput = function(){ if (readout) readout.textContent = (parseInt(size.value,10) || 120) + " px"; };

  f.on("mouse:down", function(e){ pointerDown = true; const p = f.getPointer(e.e); if (brushMode==="fire") stampAt(p,"fire"); else if (brushMode==="smoke") stampAt(p,"smoke"); else if (brushMode==="erase") eraseStampsAt(p); });
  f.on("mouse:move", function(e){ if (!pointerDown) return; const p = f.getPointer(e.e); if (brushMode==="fire") stampAt(p,"fire"); else if (brushMode==="smoke") stampAt(p,"smoke"); else if (brushMode==="erase") eraseStampsAt(p); });
  f.on("mouse:up",   function(){ pointerDown = false; });
}

function wireTextTools(){
  const addBtn = $("addTextbox"), applyBtn = $("tbApply"), delBtn = $("tbDelete");
  const tContent = $("tbContent"), tFont = $("tbFont"), tBg = $("tbBgOpacity");
  if (!addBtn || !applyBtn || !delBtn) return;

  addBtn.onclick = function(){
    const tb = new fabric.Textbox("New note", {
      left: Math.max(20, f.getWidth()*0.1),
      top:  Math.max(20, f.getHeight()*0.1),
      width: Math.min(480, Math.floor(f.getWidth()*0.6)),
      fontSize: 24,
      fill: "#fff",
      backgroundColor: "rgba(0,0,0,0.6)",
      padding: 8,
      cornerStyle:"circle", transparentCorners:false
    });
    f.add(tb); f.setActiveObject(tb); f.requestRenderAll();
    if (tContent) tContent.value = tb.text;
    if (tFont) tFont.value = String(tb.fontSize || 24);
    if (tBg) tBg.value = "0.6";
  };

  applyBtn.onclick = function(){
    const o = f.getActiveObject();
    if (!o || o.type !== "textbox") return;
    if (tContent) o.text = tContent.value || "";
    if (tFont) o.fontSize = parseInt(tFont.value || "24", 10);
    const op = tBg ? Math.max(0, Math.min(1, parseFloat(tBg.value || "0.6"))) : 0.6;
    o.backgroundColor = "rgba(0,0,0," + op + ")";
    f.requestRenderAll();
  };

  delBtn.onclick = function(){
    const o = f.getActiveObject();
    if (o && o.type === "textbox"){ f.remove(o); f.discardActiveObject(); f.requestRenderAll(); }
  };
}

function wireSelectionTools(){
  const fr = $("bringFront"), bk = $("sendBack"), del = $("deleteObj"), fh = $("flipSelH"), fv = $("flipSelV");
  if (fr) fr.onclick = function(){ const o=f.getActiveObject(); if (o){ o.bringToFront(); f.requestRenderAll(); } };
  if (bk) bk.onclick = function(){ const o=f.getActiveObject(); if (o){ o.sendToBack(); f.requestRenderAll(); } };
  if (del) del.onclick = function(){ const o=f.getActiveObject(); if (o){ f.remove(o); f.discardActiveObject(); f.requestRenderAll(); } };
  if (fh) fh.onclick = function(){ const o=f.getActiveObject(); if (o){ o.set("flipX", !o.flipX); f.requestRenderAll(); } };
  if (fv) fv.onclick = function(){ const o=f.getActiveObject(); if (o){ o.set("flipY", !o.flipY); f.requestRenderAll(); } };
}

function wireViewerControls(){
  const fitBtn = $("fit"), zi = $("zoomIn"), zo = $("zoomOut"), rl = $("rotateL"), rr = $("rotateR");
  if (fitBtn) fitBtn.onclick = function(){
    if (baseImage && baseImage.type === "image"){
      const cw=f.getWidth(), ch=f.getHeight(), s=Math.min(cw/baseImage.width, ch/baseImage.height);
      baseImage.scale(s);
      baseImage.set({ left:(cw-baseImage.width*s)/2, top:(ch-baseImage.height*s)/2 });
      f.requestRenderAll();
    } else if (baseImage && baseImage.type === "rect"){
      const tb = f.getObjects("textbox").find(function(o){ return o.isBaseText; });
      setBaseAsTextSlide(tb ? tb.text : "", tb ? tb.fontSize : 34);
    }
  };
  if (zi) zi.onclick = function(){ f.setZoom(f.getZoom()*1.1); };
  if (zo) zo.onclick = function(){ f.setZoom(f.getZoom()/1.1); };
  if (rl) rl.onclick = function(){ if (baseImage && baseImage.rotate){ baseImage.rotate((baseImage.angle || 0) + 90); f.requestRenderAll(); } };
  if (rr) rr.onclick = function(){ if (baseImage && baseImage.rotate){ baseImage.rotate((baseImage.angle || 0) - 90); f.requestRenderAll(); } };
}

function dataURLtoBlob(dataURL){ return fetch(dataURL).then(function(r){ return r.blob(); }); }
function wireExportAndSave(){
  const exportBtn = $("exportPNG");
  const saveBtn   = $("saveImage");

  if (exportBtn){
    exportBtn.onclick = async function(){
      try{
        const dataURL = await getCompositeDataURL(2000, 0.95);
        const a = document.createElement("a");
        a.href = dataURL;
        a.download = "scenario_" + (current ? current.id : "image") + "_" + Date.now() + ".jpg";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }catch(e){
        showError("Export failed: " + (e && (e.message || e)));
      }
    };
  }

  if (saveBtn){
    saveBtn.onclick = async function(){
      try{
        setAIStatus("Preparing image…");
        const dataURL = await getCompositeDataURL(1600, 0.95);
        const blob = await dataURLtoBlob(dataURL);
        setAIStatus("Uploading to cloud…");
        const url = await saveResultBlobToStorage(blob);
        setAIStatus("Saved to cloud ✓");
        console.log("[saveImage] uploaded:", url);
      }catch(e){
        showError("Save to cloud failed: " + (e && (e.message || e)));
      }
    };
  }
}

/* ---------------- UI wiring (entry) ---------------- */
export function wireScenarioUI(){
  const toggleBtn = $("toggleTools");
  if (toggleBtn){
    toggleBtn.onclick = function(){
      const app = $("app");
      if (!app) return;
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
      current = scenarios.find(function(s){ return s.id === id; }) || null;
      stopIndex = -1;
      renderThumbs();
      f.clear(); baseImage = null; fitCanvas();
      if (current && current._stops && current._stops.length > 0){ await loadStop(0); }
    };
  }

  const gps = $("useGPS");
  if (gps){
    gps.onclick = function(){
      navigator.geolocation.getCurrentPosition(function(p){
        const lat = $("stopLat"); if (lat) lat.value = p.coords.latitude.toFixed(6);
        const lng = $("stopLng"); if (lng) lng.value = p.coords.longitude.toFixed(6);
        const msg = $("metaMsg"); if (msg) msg.textContent = "GPS captured.";
      }, function(e){
        const msg = $("metaMsg"); if (msg) msg.textContent = "GPS error: " + e.message;
      }, { enableHighAccuracy:true, timeout:10000 });
    };
  }

  const saveMeta = $("saveMeta");
  if (saveMeta){
    saveMeta.onclick = async function(){
      try{
        await ensureAuthed();
        if (!current || stopIndex < 0) throw new Error("Select a stop first.");
        const s = Object.assign({}, current._stops[stopIndex]);
        const ttl = $("stopTitle"), cap = $("stopCaption"), la = $("stopLat"), ln = $("stopLng"), r = $("stopRadius");
        s.title = ttl ? (ttl.value || "").trim() : "";
        s.caption = cap ? (cap.value || "").trim() : "";
        s.lat = la && la.value.trim() !== "" ? parseFloat(la.value) : null;
        s.lng = ln && ln.value.trim() !== "" ? parseFloat(ln.value) : null;
        s.radiusMeters = r ? Math.max(5, Math.min(1000, Math.round(parseInt(r.value || "50", 10)))) : 50;

        // serialize overlays
        const objs = f.getObjects();
        const overs = [];
        for (let i=0;i<objs.length;i++){
          const o = objs[i];
          if (o === baseImage || o.isBaseText) continue;
          if (o.type === "textbox"){
            overs.push({
              kind:"text", text:o.text || "", left:o.left || 0, top:o.top || 0,
              scaleX:o.scaleX || 1, scaleY:o.scaleY || 1, angle:o.angle || 0,
              opacity: (o.opacity != null ? o.opacity : 1), fontSize:o.fontSize || 24, fill:o.fill || "#fff",
              backgroundColor:o.backgroundColor || "rgba(0,0,0,0.6)", padding:(o.padding != null ? o.padding : 8)
            });
          } else {
            const src = o.getSrc ? o.getSrc() : (o._originalElement && o._originalElement.src ? o._originalElement.src : (o.src || ""));
            overs.push({
              kind:"image", src:src,
              left:o.left || 0, top:o.top || 0, scaleX:o.scaleX || 1, scaleY:o.scaleY || 1,
              angle:o.angle || 0, opacity:(o.opacity != null ? o.opacity : 1), flipX:!!o.flipX, flipY:!!o.flipY
            });
          }
        }
        s.overlays = overs;

        const next = current._stops.slice(); next[stopIndex] = s;
        const updated = Object.assign({}, current._raw); setStops(updated, next);
        await set(dbRef(getFirebase().db, ROOT + "/" + current.id), updated);
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
          if (s.imageURL && !/^https?:\/\//.test(s.imageURL)) paths.push(s.imageURL);
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
      ROOT = await detectScenariosRoot();
      const info = getStorageInfo();
      setRootPill("root: " + ROOT + " | bucket: " + info.bucketHost);
      await loadScenarios();
      subscribeScenarios();
      if (sel && !sel.value && scenarios.length > 0){
        sel.value = scenarios[0].id;
        const ev = new Event("change"); sel.dispatchEvent(ev);
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

/* ---------------- Boot ---------------- */
export async function bootScenarios(){
  fitCanvas();
  await ensureAuthed();
  ROOT = await detectScenariosRoot();
  const info = getStorageInfo();
  setRootPill("root: " + ROOT + " | bucket: " + info.bucketHost);
  await loadScenarios();
  subscribeScenarios();

  const sel = $("scenarioSel");
  if (sel && !sel.value && scenarios.length > 0){
    sel.value = scenarios[0].id;
    const ev = new Event("change"); sel.dispatchEvent(ev);
  }

  const uid = (await ensureAuthed()).uid || "anon";
  setAuthPill("anon ✔ (" + String(uid).slice(0,8) + ")");
}
