// scenarios.js  (classic working loader logic)
// Scenario loader, canvas, overlays, and save — NO AI writes.
//
// Drop-in for: public/geophoto/scenarios.js
// Depends on:  firebase-core.js (same folder)

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
    }, { crossOrigin:"anonymous" });
  });
}

async function tryUpgradeIfTiny(stop, dims){
  const minGood = 400;
  if ((dims.naturalW >= minGood) || (dims.naturalH >= minGood)) return true;
  const seeds = [stop.storagePath, stop.gsUri, stop.imageURL].filter(Boolean);
  for (const seed of seeds){
    const candidates = candidateOriginals(seed).slice(0, 6);
    for (const c of candidates){
      try{
        const bl = await getBlobFromRefString(c);
        const res = await setBaseFromBlob(bl);
        if (res.naturalW >= minGood || res.naturalH >= minGood) return true;
      }catch{}
    }
  }
  return false;
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
}

export function serializeOverlays(){
  const out=[];
  f.getObjects().forEach(o=>{
    if (o===baseImage || o.isBaseText) return;
    if (o.type==='image'){
      out.push({
        kind:'image',
        src:o.getSrc ? o.getSrc() : (o._originalElement?.src || o.src || ''),
        left:o.left||0, top:o.top||0, scaleX:o.scaleX||1, scaleY:o.scaleY||1,
        angle:o.angle||0, opacity:o.opacity??1, flipX:!!o.flipX, flipY:!!o.flipY
      });
    } else if (o.type==='textbox'){
      out.push({
        kind:'text', text:o.text||'', left:o.left||0, top:o.top||0, scaleX:o.scaleX||1, scaleY:o.scaleY||1,
        angle:o.angle||0, opacity:o.opacity??1, fontSize:o.fontSize||24, fill:o.fill||'#fff',
        backgroundColor:o.backgroundColor||'rgba(0,0,0,0.6)', padding:o.padding??8
      });
    }
  });
  return out;
}
export function hasOverlays(){
  return f.getObjects().some(o => o!==baseImage && !o.isBaseText);
}

/* ========== scenario data (known-working loader) ========== */
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

/* ========== thumbs / selection ========== */
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

  if (s.type==='text'){
    setBaseAsTextSlide(s.text||'', s.fontSize||34);
    return;
  }

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

/* ========== public API for AI module (unchanged) ========== */
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

/* ========== UI wiring (unchanged UI, classic) ========== */
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
      const updated = Object.assign({}, current._raw); setStops(updated, next);
      await set(dbRef(getFirebase().db, `${ROOT}/${current.id}`), updated);
      current._raw = updated; current._stops = next;
      renderThumbs();
      $("metaMsg").textContent = "Meta saved.";
    }catch(e){ $("metaMsg").textContent = String(e.message||e); }
  };

  // viewer controls
  $("fit").onclick = ()=>{
    if (baseImage && baseImage.type==='image'){
      const cw=f.getWidth(), ch=f.getHeight(), s=Math.min(cw/baseImage.width, ch/baseImage.height);
      baseImage.scale(s); baseImage.set({ left:(cw-baseImage.width*s)/2, top:(ch-baseImage.height*s)/2 });
      f.requestRenderAll();
    } else if (baseImage && baseImage.type==='rect'){
      const t=f.getObjects('textbox').find(o=>o.isBaseText);
      setBaseAsTextSlide(t?t.text:'', t?t.fontSize:34);
    }
  };
  $("zoomIn").onclick = ()=> f.setZoom(f.getZoom()*1.1);
  $("zoomOut").onclick= ()=> f.setZoom(f.getZoom()/1.1);
  $("rotateL").onclick = ()=>{ if(baseImage && baseImage.rotate){ baseImage.rotate((baseImage.angle||0)+90); f.requestRenderAll(); } };
  $("rotateR").onclick = ()=>{ if(baseImage && baseImage.rotate){ baseImage.rotate((baseImage.angle||0)-90); f.requestRenderAll(); } };

  // selection helpers
  $("bringFront").onclick = ()=>{ const o=f.getActiveObject(); if(o){ o.bringToFront(); f.requestRenderAll(); } };
  $("sendBack").onclick  = ()=>{ const o=f.getActiveObject(); if(o){ o.sendToBack(); f.requestRenderAll(); } };
  $("deleteObj").onclick = ()=>{ const o=f.getActiveObject(); if(o){ f.remove(o); f.discardActiveObject(); f.requestRenderAll(); } };
  $("flipSelH").onclick  = ()=>{ const o=f.getActiveObject(); if(o){ o.set('flipX', !o.flipX); f.requestRenderAll(); } };
  $("flipSelV").onclick  = ()=>{ const o=f.getActiveObject(); if(o){ o.set('flipY', !o.flipY); f.requestRenderAll(); } };

  // overlay shelf (unchanged)
  const OVERLAY_BASE='https://fireopssim.com/geophoto/overlays/';
  const FOLDER={ fire:'fire', smoke:'smoke', people:'people', cars:'cars', hazard:'hazard' };
  const EXT=['png','webp','jpg','jpeg'];

  async function listOverlays(cat){
    try{
      const r = await fetch(`${OVERLAY_BASE}manifest.json`, { cache:'no-store' });
      if (r.ok){ const j = await r.json(); if (Array.isArray(j[FOLDER[cat]])) return j[FOLDER[cat]]; }
    }catch{}
    const prefix = {fire:'fire', smoke:'smoke', people:'person', cars:'car', hazard:'hazard'}[cat]||'img';
    const found=[]; let miss=0;
    for(let i=1;i<=60 && miss<5;i++){
      let hit=false;
      for(const ext of EXT){
        const url = `${OVERLAY_BASE}${FOLDER[cat]}/${prefix}${i}.${ext}`;
        try{ const h=await fetch(url,{method:'HEAD',cache:'no-store'}); if(h.ok){ found.push(`${prefix}${i}.${ext}`); hit=true; break; } }catch{}
      }
      miss = hit ? 0 : miss+1;
    }
    return found;
  }
  function renderShelf(cat){
    const shelf=$("overlayShelf"); shelf.innerHTML='';
    listOverlays(cat).then(files=>{
      if(!files.length){ shelf.innerHTML='<div class="pill small">No overlays found</div>'; return; }
      files.forEach(name=>{
        const url=`${OVERLAY_BASE}${FOLDER[cat]}/${name}`;
        const cell=document.createElement('div'); cell.style.border='1px solid rgba(255,255,255,14)'; cell.style.borderRadius='10px'; cell.style.padding='4px'; cell.style.background='#0b2130';
        const img=new Image(); img.src=url; img.alt=name; img.style.width='100%'; img.style.display='block';
        img.onclick=()=> addOverlay(url);
        cell.appendChild(img); shelf.appendChild(cell);
      });
    });
  }
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
  Array.from(document.querySelectorAll('#tools [data-cat]')).forEach(b=>{
    b.addEventListener('click', ()=> renderShelf(b.dataset.cat));
  });
  renderShelf('fire');

  // brushes
  let brushMode='off', pointerDown=false, lastStamp=null;
  const brushSize=$("brushSize"), brushSizeReadout=$("brushSizeReadout");
  brushSize.oninput=()=> brushSizeReadout.textContent=(parseInt(brushSize.value,10)||120)+' px';
  $("brushFire").onclick = ()=> brushMode='fire';
  $("brushSmoke").onclick= ()=> brushMode='smoke';
  $("brushErase").onclick= ()=> brushMode='erase';
  $("brushOff").onclick  = ()=> brushMode='off';
  function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }
  async function randomOverlay(cat){
    const files = await listOverlays(cat); if(!files.length) return null;
    const i=Math.floor(Math.random()*files.length);
    return `${OVERLAY_BASE}${FOLDER[cat]}/${files[i]}`;
  }
  async function stampAt(p, cat){
    const file = await randomOverlay(cat); if(!file) return;
    const R = (parseInt(brushSize.value,10)||120)/2;
    if (lastStamp && dist(p,lastStamp) < R*0.6) return; lastStamp=p;
    fabric.Image.fromURL(file, img=>{
      const baseW=img.width||200, scale=(R*2)/baseW, j=0.75+Math.random()*0.5;
      img.scale(scale*j);
      img.set({
        left:p.x-(img.width*img.scaleX)/2, top:p.y-(img.height*img.scaleY)/2, angle:(Math.random()*30-15),
        opacity:0.9, cornerStyle:'circle', transparentCorners:false, erasable:true, selectable:false, evented:false
      });
      f.add(img); f.requestRenderAll();
    }, { crossOrigin:'anonymous' });
  }
  function eraseStampsAt(p){
    const R=(parseInt(brushSize.value,10)||120)/2;
    const targets = f.getObjects('image').filter(o => o!==baseImage);
    for (const obj of targets){
      const cx=obj.left + (obj.width*obj.scaleX)/2, cy=obj.top + (obj.height*obj.scaleY)/2;
      if (Math.hypot(cx-p.x, cy-p.y) <= R) f.remove(obj);
    }
    f.requestRenderAll();
  }
  f.on('mouse:down', (e)=>{ pointerDown=true; const p=f.getPointer(e.e); if(brushMode==='fire') stampAt(p,'fire'); else if(brushMode==='smoke') stampAt(p,'smoke'); else if(brushMode==='erase') eraseStampsAt(p); });
  f.on('mouse:move', (e)=>{ if(!pointerDown) return; const p=f.getPointer(e.e); if(brushMode==='fire') stampAt(p,'fire'); else if(brushMode==='smoke') stampAt(p,'smoke'); else if(brushMode==='erase') eraseStampsAt(p); });
  f.on('mouse:up', ()=>{ pointerDown=false; });

  // delete scenario
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

  // refresh/init buttons (classic)
  $("refreshBtn").onclick = async ()=>{
    await ensureAuthed();
    ROOT = await detectRoot();
    const { bucketHost } = getStorageInfo();
    setRootPill(`root: ${ROOT} | bucket: ${bucketHost}`);
    await loadScenarios();
    subscribeScenarios();
  };
}

/* ========== boot (classic) ========== */
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
