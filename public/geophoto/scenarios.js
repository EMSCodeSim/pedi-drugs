// scenarios.js  (classic working loader logic)
// Depends on: firebase-core.js (same folder)

import {
  getFirebase, ensureAuthed, getStorageInfo,
  toStorageRefString, getBlobFromRefString, candidateOriginals
} from "./firebase-core.js";
import {
  ref as dbRef, get, set, remove, onValue
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";
import {
  ref as stRef, getDownloadURL, uploadBytesResumable, uploadBytes, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ========== tiny DOM helpers ========== */
const $ = (id) => document.getElementById(id);
const errbar = () => $("errbar");
export function setAuthPill(text){ $("authPill").textContent = `Auth: ${text}`; }
export function setStatus(text){ $("statusPill").textContent = text; }
export function setRootPill(text){ $("rootPill").textContent = text; }
export function setAIStatus(text){ const el=$("aiMsg"); if(el) el.textContent = text; }
export function showError(msg){ const b=errbar(); b.textContent=String(msg); b.style.display='block'; console.error(msg); }
export function hideError(){ errbar().style.display='none'; }
export function showLoad(on){ $("loader").style.display = on ? "grid" : "none"; }

/* ========== canvas (unchanged behavior) ========== */
export const f = new fabric.Canvas("c", { backgroundColor:"#061621", preserveObjectStacking:true });
let baseImage = null;

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
      resolve({ naturalW: img.width, naturalH: img.height });
    }, { crossOrigin:'anonymous' });
  });
}

/* ========== overlays (unchanged) ========== */
function serializeOverlays(){
  const out=[];
  f.getObjects().forEach(o=>{
    if (o===baseImage) return;
    if (o.type==='textbox' || o.isBaseText){
      out.push({
        kind:'text', text:o.text||'', left:o.left||0, top:o.top||0,
        scaleX:o.scaleX||1, scaleY:o.scaleY||1, angle:o.angle||0, opacity:o.opacity??1,
        fontSize:o.fontSize||24, fill:o.fill||'#fff', backgroundColor:o.backgroundColor||'rgba(0,0,0,0.6)', padding:o.padding??8
      });
    }else if (o.type==='image'){
      out.push({
        src:o._originalUrl || o.src || o._element?.src || '',
        left:o.left||0, top:o.top||0, scaleX:o.scaleX||1, scaleY:o.scaleY||1,
        angle:o.angle||0, opacity:o.opacity??1, flipX:!!o.flipX, flipY:!!o.flipY
      });
    }
  });
  return out;
}
export function hasOverlays(){ return f.getObjects().some(o => o!==baseImage && !o.isBaseText); }

/* ========== scenario data (KNOWN-WORKING LOADER) ========== */
let ROOT = "scenarios";
let scenarios = [], current = null, stopIndex = -1;

const { db, storage } = getFirebase();

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

async function detectRoot(){
  const fromQS = new URLSearchParams(location.search).get('root');
  if (fromQS) return fromQS;
  try{
    const snap = await get(dbRef(db, 'geophoto/scenarios'));
    if (snap.exists()) return 'geophoto/scenarios';
  }catch{}
  return 'scenarios';
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

/* ========== stop load/render (unchanged) ========== */
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
    const blob = await getBlobFromRefString(s.gsUri || s.storagePath || s.imageURL || s.imageData);
    const dims = await setBaseFromBlob(blob);
    const ok = await tryUpgradeIfTiny(s, dims);
    if (!ok && (dims.naturalW < 400 || dims.naturalH < 400)){
      showError('Loaded a small thumbnail. A higher-resolution original could not be found.');
    }
  }catch(e){
    showError('Image load failed (rules?): '+(e.message||e));
  }finally{
    showLoad(false);
  }

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

/* ========== public API used by ai-upload.js ========== */
export async function getGuideImageURLForCurrentStop(){
  if (!current || stopIndex<0) throw new Error('No stop selected');
  const s = current._stops[stopIndex];
  const { storage } = getFirebase();

  if (s?.imageURL && /^https?:\/\//i.test(s.imageURL)) return s.imageURL;
  const refStr = s?.storagePath || s?.gsUri;
  if (refStr){
    const ref = stRef(storage, toStorageRefString(refStr));
    return await getDownloadURL(ref);
  }
  if (s?.imageData?.data){
    return `data:image/${s.imageData.format||'jpeg'};base64,${s.imageData.data}`;
  }
  throw new Error('This stop has no accessible base image.');
}

export async function getCompositeDataURL(maxEdge = 1600, quality = 0.95){
  const raw = f.toDataURL({ format:'jpeg', quality:1 });
  const img = new Image(); img.decoding='async'; img.src=raw; await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const s = Math.min(1, maxEdge / Math.max(w, h));
  const outW = Math.round(w*s), outH = Math.round(h*s);
  const c = document.createElement('canvas'); c.width=outW; c.height=outH;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
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

/* ========== UI wiring ========== */
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

export function wireScenarioUI(){
  $("toggleTools").onclick = ()=>{
    const app = $("app");
    const collapse = !app.classList.contains('toolsCollapsed');
    app.classList.toggle('toolsCollapsed', collapse);
    $("toggleTools").textContent = collapse ? 'Show Tools' : 'Hide Tools';
    fitCanvas();
  };

  $("scenarioSel").onchange = async ()=>{
    const id = $("scenarioSel").value;
    current = scenarios.find(s=>s.id===id) || null;
    stopIndex = -1;
    renderThumbs();
    f.clear(); baseImage=null; fitCanvas();
    if (current && current._stops.length){ await loadStop(0); }
  };

  $("useGPS").onclick = ()=>{
    navigator.geolocation.getCurrentPosition(p=>{
      $("stopLat").value = p.coords.latitude.toFixed(6);
      $("stopLng").value = p.coords.longitude.toFixed(6);
      $("metaMsg").textContent = "GPS captured.";
    }, e=>{ $("metaMsg").textContent = "GPS error: " + e.message; }, { enableHighAccuracy:true, timeout:10_000 });
  };

  $("saveMeta").onclick = async ()=>{
    try{
      await ensureAuthed();
      if (!current || stopIndex<0) throw new Error('Select a stop first.');
      const s = Object.assign({}, current._stops[stopIndex]);
      s.title = $("stopTitle").value.trim();
      s.caption = $("stopCaption").value.trim();
      const lat = $("stopLat").value.trim()==='' ? null : parseFloat($("stopLat").value);
      const lng = $("stopLng").value.trim()==='' ? null : parseFloat($("stopLng").value);
      s.lat = lat; s.lng = lng;
      s.radiusMeters = Math.max(5, Math.min(1000, Math.round(parseInt($("stopRadius").value || "50", 10))));
      s.overlays = serializeOverlays();
      const next = current._stops.slice(); next[stopIndex] = s;
      const updated = Object.assign({}, current._raw);
      setStops(updated, next);
      await set(dbRef(getFirebase().db, `${ROOT}/${current.id}`), updated);
      current._raw = updated; current._stops = next;
      $("metaMsg").textContent = "Saved ✓";
    }catch(e){
      $("metaMsg").textContent = e?.message || String(e);
    }
  };

  // Delete scenario
  $("deleteScenario").onclick = async ()=>{
    if (!current) return;
    if (!confirm('Delete this scenario and its cloud images?')) return;
    try{
      showLoad(true);
      await ensureAuthed();
      const paths = [];
      (current._stops||[]).forEach(s=>{
        if (s.storagePath) paths.push(s.storagePath);
        if (s.gsUri) paths.push(s.gsUri);
        if (s.imageURL && !/^https?:\/\//.test(s.imageURL)) paths.push(s.imageURL);
      });
      for (const p of paths){
        try{ await deleteObject(stRef(getFirebase().storage, toStorageRefString(p))); }catch{}
      }
      await remove(dbRef(getFirebase().db, `${ROOT}/${current.id}`));
      current=null; stopIndex=-1; populateScenarios(); $("scenarioSel").value=''; $("thumbRow").innerHTML='';
      f.clear(); baseImage=null; fitCanvas();
      setStatus('Scenario deleted.');
    }catch(e){
      showError('Delete failed (rules?): '+(e?.message||e));
    }finally{
      showLoad(false);
    }
  };

  // Refresh/init (classic)
  $("refreshBtn").onclick = async ()=>{
    await ensureAuthed();
    ROOT = await detectRoot();
    const { bucketHost } = getStorageInfo();
    setRootPill(`root: ${ROOT} | bucket: ${bucketHost}`);
    await loadScenarios();
    subscribeScenarios();
  };
}

/* ========== boot ========== */
export async function bootScenarios(){
  fitCanvas();
  await ensureAuthed();
  ROOT = await detectRoot();
  const { bucketHost } = getStorageInfo();
  setRootPill(`root: ${ROOT} | bucket: ${bucketHost}`);
  await loadScenarios();
  subscribeScenarios();

  const uid = (await ensureAuthed()).uid.slice(0,8);
  setAuthPill(`anon ✔ (${uid})`);
}
