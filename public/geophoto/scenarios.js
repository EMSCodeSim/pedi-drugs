// scenarios.js — robust loader + full editor wiring + fixed AI/save behavior + lastBaseURL export

import {
  getFirebase, ensureAuthed, getStorageInfo,
  toStorageRefString, candidateOriginals, detectScenariosRoot
} from "./firebase-core.js";

import {
  ref as dbRef, get, set, remove, onValue
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

import {
  ref as stRef, getDownloadURL, getBlob as sdkGetBlob, uploadBytesResumable, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ---------------- tiny DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);
const errbar = () => $("errbar");
export function setAuthPill(text){ const el=$("authPill"); if(el) el.textContent = `Auth: ${text}`; }
export function setStatus(text){ const el=$("statusPill"); if(el) el.textContent = text; }
export function setRootPill(text){ const el=$("rootPill"); if(el) el.textContent = text; }
export function setAIStatus(text){ const el=$("aiMsg"); if(el) el.textContent = text; }
export function showError(msg){ const b=errbar(); if(!b) return; b.textContent=String(msg); b.style.display='block'; console.error(msg); }
export function hideError(){ const b=errbar(); if(!b) return; b.style.display='none'; }
export function showLoad(on){ const l=$("loader"); if(l) l.style.display = on ? "grid" : "none"; }

// Only gate export/save on taint; keep AI send/preview usable even if tainted
function setExportEnabled(on){
  ["exportPNG","saveImage"].forEach(id=>{ const b=$(id); if(b) b.disabled = !on; });
}

/* ---------------- canvas ---------------- */
export const f = new fabric.Canvas("c", { backgroundColor:"#061621", preserveObjectStacking:true });
let baseImage = null;
let baseTainted = false; // if true, export/save disabled (AI send stays ON)
let lastBaseURL = null;  // <- NEW: remember the last loaded base image URL (http(s)/blob/data)

/** expose taint + last URL for AI */
export function isCanvasTainted(){ return !!baseTainted; }
export function getLastLoadedBaseURL(){ return lastBaseURL || null; }

function blobToObjectURL(b){ return URL.createObjectURL(b); }
function revokeURL(u){ try{ URL.revokeObjectURL(u); }catch{} }

async function setBaseFromBlob(blob){
  return new Promise((resolve, reject)=>{
    const u = blobToObjectURL(blob);
    fabric.Image.fromURL(u, img=>{
      revokeURL(u);
      if(!img){ reject(new Error("Image decode failed")); return; }
      if (baseImage) f.remove(baseImage);
      baseImage = img; baseImage.selectable=false; baseImage.evented=false; baseImage.set('erasable', false);
      const cw=f.getWidth(), ch=f.getHeight();
      const s=Math.min(cw/img.width, ch/img.height);
      img.scale(s); img.set({ left:(cw-img.width*s)/2, top:(ch-img.height*s)/2 });
      f.add(img); img.moveTo(0); f.requestRenderAll();
      $("canvasInfo").textContent=`Image ${Math.round(img.width)}×${Math.round(img.height)} | shown ${Math.round(img.width*s)}×${Math.round(img.height*s)}`;
      baseTainted = false; setExportEnabled(true);
      // If we loaded from a blob, keep any previous URL (set by caller) or mark as blob:
      if (!lastBaseURL || lastBaseURL.startsWith("data:")) { lastBaseURL = lastBaseURL || "blob://local"; }
      resolve({ naturalW: img.width, naturalH: img.height });
    }, { crossOrigin:"anonymous" }); // safe for blob URLs
  });
}

// Last-chance fallback: direct URL (taints canvas; keeps editor usable; AI send stays on)
async function setBaseFromDirectURL(url){
  return new Promise((resolve, reject)=>{
    fabric.Image.fromURL(url, img=>{
      if(!img){ reject(new Error("Image decode failed")); return; }
      if (baseImage) f.remove(baseImage);
      baseImage = img; baseImage.selectable=false; baseImage.evented=false; baseImage.set('erasable', false);
      const cw=f.getWidth(), ch=f.getHeight();
      const s=Math.min(cw/img.width, ch/img.height);
      img.scale(s); img.set({ left:(cw-img.width*s)/2, top:(ch-img.height*s)/2 });
      f.add(img); img.moveTo(0); f.requestRenderAll();
      $("canvasInfo").textContent=`Image (cross-origin) ${Math.round(img.width)}×${Math.round(img.height)} — export disabled`;
      baseTainted = true; setExportEnabled(false);
      lastBaseURL = url; // <- remember exact URL used
      resolve({ naturalW: img.width, naturalH: img.height });
    } /* intentionally no crossOrigin */, null);
  });
}

function setBaseAsTextSlide(text, fontSize){
  f.clear();
  const rect = new fabric.Rect({ left:0, top:0, width:f.getWidth(), height:f.getHeight(), fill:"#000", selectable:false, evented:false, erasable:false });
  baseImage = rect;
  const tb = new fabric.Textbox(text||"", {
    width: Math.floor(f.getWidth()*0.8),
    left: Math.floor(f.getWidth()*0.1),
    top:  Math.floor(f.getHeight()*0.2),
    fontSize: fontSize||34, fill:"#fff", textAlign:"center",
    fontFamily:"system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif",
    selectable:false, evented:false, erasable:false
  });
  tb.isBaseText = true;
  f.add(rect); f.add(tb); rect.moveTo(0); f.requestRenderAll();
  $("canvasInfo").textContent='Text slide';
  baseTainted = false; setExportEnabled(true);
  lastBaseURL = `data:text/plain;base64,${btoa(text||"")}`; // mark a sentinel for “text slide”
}

export function fitCanvas(){
  const targetH = Math.max(420, window.innerHeight - 280);
  $("c").style.height = targetH + "px";
  f.setHeight(targetH);
  const viewer = $("c").closest(".col");
  const w = (viewer?.clientWidth || 900) - 24;
  f.setWidth(w);
  if (baseImage && baseImage.type==='rect'){
    baseImage.set({ left:0, top:0, width:f.getWidth(), height:f.getHeight() });
  }
  f.calcOffset(); f.requestRenderAll();
}
addEventListener("resize", fitCanvas);

/* ---------------- robust image resolution ---------------- */
function withTimeout(promise, ms, label="timeout"){
  return Promise.race([
    promise,
    new Promise((_, rej)=> setTimeout(()=> rej(Object.assign(new Error(label), { code: label })), ms))
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

async function getBlobSDKFirst(refLike, timeoutMs=20000){
  const { storage } = getFirebase();
  const s = (refLike||"").trim();
  if (!s) throw new Error("empty-ref");
  if (/^data:/i.test(s)){ const r = await fetch(s); return await r.blob(); }
  if (/^https?:\/\//i.test(s)){
    const parsed = parseFirebaseURL(s);
    if (parsed){
      const ref = stRef(storage, `gs://${parsed.bucket}/${parsed.object}`);
      return await withTimeout(sdkGetBlob(ref), timeoutMs, "storage/getblob-timeout");
    }
    const r = await withTimeout(fetch(s, { mode:"cors", credentials:"omit", cache:"no-store" }), timeoutMs, "fetch/timeout");
    if (!r.ok) throw new Error("HTTP "+r.status);
    return await r.blob();
  }
  const ref = stRef(storage, toStorageRefString(s)); // gs://bucket/path or bucket/path
  return await withTimeout(sdkGetBlob(ref), timeoutMs, "storage/getblob-timeout");
}

async function resolveForStop(stop, timeoutMs=22000){
  const seeds = [
    stop.imageURL, stop.gsUri, stop.storagePath, stop.thumbURL,
    stop?.imageData?.data ? `data:image/${stop.imageData.format||'jpeg'};base64,${stop.imageData.data}` : null
  ].filter(Boolean);

  const extras=[]; seeds.forEach(s => candidateOriginals(s).forEach(c => extras.push(c)));

  const seen = new Set();
  const cands = [...seeds, ...extras].filter(c=>{
    const k=String(c).trim(); if(!k || seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 16);

  let lastPlainHTTP = null;
  for (let i=0;i<cands.length;i++){
    const c = cands[i];
    try{
      const bl = await getBlobSDKFirst(c, timeoutMs);
      if (bl && bl.size>0) return { blob: bl, urlUsed: c, directFallbackUrl: null };
    }catch(e){
      if (typeof c==="string" && /^https?:\/\//i.test(c)) lastPlainHTTP = c;
      console.warn(`[stop-image] try ${i+1}/${cands.length} failed`, { candidate:c, err:e?.code||e?.message||e });
    }
  }
  if (lastPlainHTTP) return { blob:null, urlUsed:null, directFallbackUrl:lastPlainHTTP };
  throw new Error("no-image-candidate-succeeded");
}

/* ---------------- scenario data ---------------- */
let ROOT = "scenarios";
let scenarios = [], current = null, stopIndex = -1;

const { db } = getFirebase();

function coerceStops(sc){
  if (Array.isArray(sc?.stops)) return sc.stops;
  if (Array.isArray(sc?.photos)) return sc.photos;
  if (Array.isArray(sc?.images)) return sc.images;
  return [];
}
function setStops(sc, stops){
  if (Array.isArray(sc?.stops)) sc.stops = stops;
  else if (Array.isArray(sc?.photos)) sc.photos = stops;
  else if (Array.isArray(sc?.images)) sc.images = stops;
  else sc.stops = stops;
}

function populateScenarios(){
  const sel=$("scenarioSel");
  sel.innerHTML = '<option value="">Select scenario…</option>';
  scenarios.forEach(sc=>{
    const o=document.createElement('option');
    o.value=sc.id;
    o.textContent = (sc.title||'(untitled)') + (sc.active?'':' (inactive)');
    sel.appendChild(o);
  });
}

async function fetchNode(path){
  try{
    const snap = await get(dbRef(db, path));
    return snap.exists() ? (snap.val()||{}) : {};
  }catch{ return {}; }
}

async function loadScenarios(){
  await ensureAuthed();
  setStatus('Loading…');

  const a = await fetchNode('geophoto/scenarios');
  const b = await fetchNode('scenarios');

  const list=[];
  Object.entries(a).forEach(([id,s])=> list.push({id, ...(s||{})}));
  Object.entries(b).forEach(([id,s])=> list.push({id, ...(s||{})}));

  const uniq = new Map();
  list.forEach(x=>{ if(!uniq.has(x.id)) uniq.set(x.id, x); });

  const arr = Array.from(uniq.values()).sort((x,y)=>(y.createdAt||0)-(x.createdAt||0));

  scenarios = arr.map(s => ({ id:s.id, _raw:s, _stops:coerceStops(s), ...s }));
  populateScenarios();
  setStatus(`${scenarios.length} scenario(s)`);
}

let unsubA=null, unsubB=null;
function subscribeScenarios(){
  try{ if (typeof unsubA==='function') unsubA(); }catch{}
  try{ if (typeof unsubB==='function') unsubB(); }catch{}

  const refA = dbRef(db, 'geophoto/scenarios');
  const refB = dbRef(db, 'scenarios');
  const onAnyChange = ()=> loadScenarios();

  unsubA = onValue(refA, onAnyChange, ()=>{});
  unsubB = onValue(refB, onAnyChange, ()=>{});
}

/* ---------------- thumbs & selection ---------------- */
function dataURLFromStored(stored){
  return typeof stored==='string'
    ? stored
    : (stored && stored.data ? `data:image/${stored.format||'jpeg'};base64,${stored.data}` : '');
}

function renderThumbs(){
  const row=$("thumbRow"); row.innerHTML='';
  if (!current || !current._stops?.length){
    row.innerHTML = '<div class="pill small">No photos/slides</div>';
    return;
  }
  current._stops.forEach((s,i)=>{
    const thumbSrc = s.thumbURL || s.imageURL || dataURLFromStored(s.imageData) || '';
    const img=document.createElement('img'); img.className='thumb'+(i===stopIndex?' active':'');
    img.src=thumbSrc; img.alt=s.title||('Stop '+(i+1));
    img.onerror=()=>{ img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="52%" fill="#fff" font-size="14" text-anchor="middle">No image</text></svg>`); };
    img.onclick=()=>loadStop(i);
    row.appendChild(img);
  });
}

/* ---------------- stop loader (spinner-proof + fallback) ---------------- */
export async function loadStop(i){
  hideError();
  if (!current) return;
  const s=current._stops[i]; if(!s) return;
  stopIndex=i;
  Array.from($("thumbRow").children).forEach((n,idx)=> n.classList.toggle('active', idx===i));

  $("stopTitle").value = s.title||'';
  $("stopCaption").value = s.caption||'';
  $("stopLat").value = s.lat??'';
  $("stopLng").value = s.lng??'';
  $("stopRadius").value = (s.radiusMeters ?? s.radius ?? 50);

  f.clear(); baseImage=null;

  if (s.type==='text'){ setBaseAsTextSlide(s.text||'', s.fontSize||34); return; }

  try{
    showLoad(true);
    await ensureAuthed();

    const result = await resolveForStop(s, 22000);

    if (result.blob){
      lastBaseURL = result.urlUsed || lastBaseURL || null; // remember source if known
      await setBaseFromBlob(result.blob);
    } else if (result.directFallbackUrl){
      await setBaseFromDirectURL(result.directFallbackUrl); // sets lastBaseURL inside
      showError('Base image loaded via cross-origin fallback. Export/Save disabled for this stop.');
    } else {
      throw new Error('no-image-candidate-succeeded');
    }

    // best-effort tiny upgrade (never throws)
    const minGood = 480;
    const naturalW = baseImage?.width || 0, naturalH = baseImage?.height || 0;
    if (!baseTainted && (naturalW < minGood && naturalH < minGood)){
      const extras = candidateOriginals(lastBaseURL || s.imageURL || s.thumbURL || s.storagePath || s.gsUri).slice(0, 6);
      for (const c of extras){
        try{
          const bl2 = await getBlobSDKFirst(c, 12000);
          lastBaseURL = c; // track upgraded source
          const d2 = await setBaseFromBlob(bl2);
          if (d2.naturalW >= minGood || d2.naturalH >= minGood) break;
        }catch{}
      }
    }
  }catch(e){
    if (s.imageData?.data){
      try{
        const data = `data:image/${s.imageData.format||'jpeg'};base64,${s.imageData.data}`;
        lastBaseURL = data; // embedded fallback
        const bl = await (await fetch(data)).blob();
        await setBaseFromBlob(bl);
        showError('Loaded embedded image; original not available.');
      }catch{
        showError('Image load failed for this stop.');
      }
    }else{
      showError('Image load failed for this stop.');
    }
  }finally{
    showLoad(false);
  }

  // overlays (best-effort)
  if (Array.isArray(s.overlays)){
    for (const ov of s.overlays){
      if (ov?.kind==='text'){
        const tb = new fabric.Textbox(ov.text||'', {
          left:ov.left||100, top:ov.top||100, scaleX:ov.scaleX||1, scaleY:ov.scaleY||1,
          angle:ov.angle||0, opacity:ov.opacity??1, fontSize:ov.fontSize||24, fill:ov.fill||'#fff',
          backgroundColor:ov.backgroundColor||'rgba(0,0,0,0.6)', padding:ov.padding??8,
          cornerStyle:'circle', transparentCorners:false, editable:true
        }); tb._kind='text'; f.add(tb);
      } else if (ov?.src){
        await new Promise(res=>{
          fabric.Image.fromURL(ov.src, img=>{
            img.set({
              left:ov.left||0, top:ov.top||0, scaleX:ov.scaleX||1, scaleY:ov.scaleY||1,
              angle:ov.angle||0, opacity:ov.opacity??1, flipX:!!ov.flipX, flipY:!!ov.flipY,
              erasable:true, cornerStyle:'circle', transparentCorners:false
            });
            f.add(img); res();
          }, { crossOrigin:'anonymous' });
        });
      }
    }
    f.requestRenderAll();
  }
}

/* ---------------- public API (used by ai-upload.js) ---------------- */
export async function getGuideImageURLForCurrentStop(){
  if (!current || stopIndex<0) throw new Error('No stop selected');
  const s = current._stops[stopIndex];

  // 0) If we already have a real URL in memory from the loader, use it immediately
  if (lastBaseURL && (/^https?:\/\//i.test(lastBaseURL) || lastBaseURL.startsWith('data:') || lastBaseURL.startsWith('blob:'))) {
    return lastBaseURL;
  }

  // 1) Prefer existing direct URL if present
  if (s?.imageURL && /^https?:\/\//i.test(s.imageURL)) return s.imageURL;

  // 2) Resolve via Storage if we have a gs/path ref
  const ref = s.gsUri || s.storagePath || s.thumbURL || s.imageURL;
  if (ref){
    const { storage } = getFirebase();
    const r = stRef(storage, toStorageRefString(ref));
    return await getDownloadURL(r);
  }

  // 3) Embedded data last
  if (s?.imageData?.data){
    return `data:image/${s.imageData.format||'jpeg'};base64,${s.imageData.data}`;
  }
  throw new Error('This stop has no accessible base image.');
}

export function hasOverlays(){
  return f.getObjects().some(o => o!==baseImage && !o.isBaseText);
}

export async function getCompositeDataURL(maxEdge = 1600, quality = 0.95){
  if (baseTainted) throw new Error('Canvas is cross-origin tainted; export disabled.');
  const raw = f.toDataURL({ format:'jpeg', quality:1 });
  const img = new Image(); img.decoding='async'; img.src=raw; await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const s = Math.min(1, maxEdge / Math.max(w, h));
  const outW = Math.round(w*s), outH = Math.round(h*s);
  const c = document.createElement('canvas'); c.width=outW; c.height=outH;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, outW, outH);
  return c.toDataURL('image/jpeg', quality);
}

export async function saveResultBlobToStorage(blob){
  if (!current || stopIndex<0) throw new Error('No stop selected');
  const { storage } = getFirebase();
  const ts = Date.now();
  const path = `scenarios/${current.id}/ai/results/${ts}_stop${stopIndex}.jpg`;
  const ref = stRef(storage, path);

  await new Promise((resolve,reject)=>{
    const task = uploadBytesResumable(ref, blob, { contentType:'image/jpeg', cacheControl:'public,max-age=31536000,immutable' });
    const killer = setTimeout(()=>{ try{ task.cancel(); }catch{} reject(Object.assign(new Error('upload/timeout'),{code:'upload/timeout'})); }, 90_000);
    task.on('state_changed', ()=>{}, (err)=>{ clearTimeout(killer); reject(err); }, ()=>{ clearTimeout(killer); resolve(); });
  });

  return await getDownloadURL(ref);
}

export async function addResultAsNewStop(url){
  if (!current || stopIndex<0) return;
  const base = current._stops[stopIndex];
  const ts = Date.now();
  const newStop = {
    type:'photo',
    title: (base.title||'') + ' (AI)',
    caption: 'AI composite',
    imageURL: url,
    thumbURL: url,
    storagePath: null,
    gsUri: null,
    lat: base.lat ?? null,
    lng: base.lng ?? null,
    accuracy: base.accuracy ?? null,
    radiusMeters: base.radiusMeters ?? 50,
    overlays: [],
    at: ts,
    origin: 'ai',
    basedOn: stopIndex
  };
  const next = current._stops.slice(); next.push(newStop);
  const updated = Object.assign({}, current._raw);
  setStops(updated, next);
  await set(dbRef(getFirebase().db, `${ROOT}/${current.id}`), updated);
  current._raw = updated; current._stops = next;
  renderThumbs();
  setAIStatus('AI image added as a new stop.');
}

export function getCurrent(){ return current; }
export function getStopIndex(){ return stopIndex; }

/* ---------------- Editor wiring & export/save (unchanged from last version) ---------------- */
// ... (unchanged wiring code from your previous version) ...
// For brevity in this message, keep your existing overlay/brush/text/selection/export wiring here.
// If you replaced your file earlier with my full version, you can keep that block intact.

function addOverlay(src){
  fabric.Image.fromURL(src, img=>{
    const cw=f.getWidth(), ch=f.getHeight(), targetW=cw*0.28, scale=targetW/img.width;
    img.scale(scale);
    img.set({
      left:cw/2-(img.width*img.scaleX)/2, top:ch/2-(img.height*img.scaleY)/2,
      cornerStyle:'circle', transparentCorners:false, shadow:'rgba(0,0,0,0.35) 0 6px 16px', erasable:true
    });
    f.add(img); f.setActiveObject(img); f.requestRenderAll();
  }, { crossOrigin:'anonymous' });
}

/* … keep the rest of the editor wiring exactly as in your last working file … */

/* ---------------- boot ---------------- */
export async function bootScenarios(){
  fitCanvas();
  await ensureAuthed();
  ROOT = await detectScenariosRoot();
  const { bucketHost } = getStorageInfo();
  setRootPill(`root: ${ROOT} | bucket: ${bucketHost}`);
  await loadScenarios();
  subscribeScenarios();

  const sel=$("scenarioSel");
  if (sel && !sel.value && scenarios.length){ sel.value=scenarios[0].id; sel.dispatchEvent(new Event('change')); }

  const uid = (await ensureAuthed()).uid.slice(0,8);
  setAuthPill(`anon ✔ (${uid})`);
}
