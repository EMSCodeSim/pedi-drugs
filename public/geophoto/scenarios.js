// scenarios.js — storage-only loader with thumbnails + canvas display
// Requires: firebase-core.js (same folder) and FabricJS loaded before this module.

import {
  getFirebase,
  ensureAuthed,
  getStorageInfo,
  toStorageRefString,
} from "./firebase-core.js";

import {
  ref as stRef,
  listAll,
  getDownloadURL,
  getBlob as storageGetBlob,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const setTxt = (id, t) => { const el=$(id); if (el) el.textContent=t; };
const log  = (...a) => { try{ console.log("[scenarios]", ...a); }catch(_){} };
const warn = (...a) => { try{ console.warn("[scenarios]", ...a); }catch(_){} };

/* ---------- canvas + fallback <img> ---------- */
let f=null, baseImage=null;

function ensureCanvas(){
  if (f) return f;
  if (!window.fabric) throw new Error("fabric not loaded");
  f = new fabric.Canvas("c", { backgroundColor:"#061621", preserveObjectStacking:true });
  window.addEventListener("resize", fitCanvas);
  fitCanvas();
  return f;
}
function fitCanvas(){
  if (!f) return;
  const wrap = f.lowerCanvasEl.parentElement || document.body;
  const w = Math.max(320, wrap.clientWidth  - 8);
  const h = Math.max(240, wrap.clientHeight - 8);
  f.setWidth(w); f.setHeight(h);
  if (baseImage){
    const bw = baseImage.width || 1, bh = baseImage.height || 1;
    const s = Math.min(w/bw, h/bh);
    baseImage.set({ scaleX:s, scaleY:s, left:(w - bw*s)/2, top:(h - bh*s)/2 });
    f.requestRenderAll();
  }
}

/* ---------- state ---------- */
const ROOT = "scenarios";
let scenarios = [];            // [{id}]
let currentId = "";
let stops = [];                // [{path,url,title}]
let stopIdx = -1;

/* ---------- storage listing ---------- */
async function listScenarioIds(){
  const { storage } = getFirebase();
  const res = await listAll(stRef(storage, ROOT));
  return (res.prefixes || []).map(p => p.name);
}
async function listFilesUnderScenario(id){
  const { storage } = getFirebase();
  const base = `${ROOT}/${id}`;
  const paths = [];
  async function walk(prefix){
    const res = await listAll(stRef(storage, prefix));
    (res.items || []).forEach(it => paths.push(it.fullPath || `${prefix}/${it.name}`));
    for (const sub of (res.prefixes || [])) {
      const leaf = (sub.name || "").toLowerCase();
      if (leaf === "masks" || leaf === "overlays") continue;
      if (leaf === "results" && prefix.toLowerCase().endsWith("/ai")) continue;
      await walk(sub.fullPath || `${prefix}/${sub.name}`);
    }
  }
  await walk(base);
  log(`Found ${paths.length} under ${base}`, paths.slice(0,12));
  return paths;
}
async function buildStopsFromPaths(paths){
  const { storage } = getFirebase();
  const out = [];
  for (const p of paths){
    try{
      const url = await getDownloadURL(stRef(storage, p));
      out.push({ path:p, url, title: p.split("/").pop() || "photo" });
    }catch(e){ warn("getDownloadURL:", p, e?.message||e); }
  }
  return out;
}

/* ---------- rendering ---------- */
function renderThumbs(){
  const row = $("thumbRow"); if (!row) return;
  row.innerHTML = "";
  if (!stops.length){ row.innerHTML = '<div class="pill small">No photos/slides</div>'; return; }
  stops.forEach((s,i)=>{
    const img = document.createElement("img");
    img.className = "thumb" + (i===stopIdx?" active":"");
    img.src = s.url; img.alt = s.title; img.title = s.path;
    img.onclick = () => loadStop(i);
    row.appendChild(img);
  });
}

async function loadStop(i){
  stopIdx = i;
  const s = stops[i]; if (!s) return;
  setTxt("statusPill", `Loading: ${s.title}`);
  try{
    ensureCanvas();
    const blob = await tryBlobThenFetch(s);
    await setCanvasFromBlob(blob);
    const fb = $("fullsizeFallback");
    if (fb){ fb.src = s.url; fb.style.display = "block"; }
    setTxt("statusPill", `Loaded: ${s.title}`);
  }catch(e){
    warn("loadStop error:", e);
    const fb = $("fullsizeFallback");
    if (fb){ fb.src = s.url; fb.style.display = "block"; }
    setTxt("statusPill", "Load failed (fallback shown)");
  }
  renderThumbs();
}

async function tryBlobThenFetch(stop){
  try{
    const { storage } = getFirebase();
    const r = stRef(storage, toStorageRefString(stop.path || stop.url));
    return await storageGetBlob(r);
  }catch(_){}
  const r = await fetch(stop.url, { mode:"cors", cache:"force-cache" });
  if (!r.ok) throw new Error("fetch blob " + r.status);
  return await r.blob();
}
async function setCanvasFromBlob(blob){
  ensureCanvas();
  return new Promise((res,rej)=>{
    const u = URL.createObjectURL(blob);
    fabric.Image.fromURL(u, (img)=>{
      if (!img){ URL.revokeObjectURL(u); rej(new Error("fabric null")); return; }
      baseImage = img; img.set({ selectable:false, evented:false });
      f.clear(); f.add(img); img.moveTo(0); fitCanvas(); f.requestRenderAll();
      URL.revokeObjectURL(u); res();
    }, { crossOrigin:"anonymous" });
  });
}

/* ---------- UI: exported wireScenarioUI() ---------- */
export function wireScenarioUI(){
  const sel = $("scenarioSel");
  if (sel){
    sel.onchange = async () => {
      currentId = sel.value || "";
      if (!currentId){ stops=[]; renderThumbs(); return; }
      setTxt("statusPill","Listing files…");
      const paths = await listFilesUnderScenario(currentId);
      setTxt("debugBox", `Paths (${paths.length})\n${paths.slice(0,12).join("\n")}${paths.length>12? "\n…" : ""}`);
      if (!paths.length){ stops=[]; renderThumbs(); setTxt("statusPill","No images found."); return; }
      setTxt("statusPill","Resolving URLs…");
      stops = await buildStopsFromPaths(paths);
      renderThumbs();
      setTxt("statusPill", `${stops.length} file(s) resolved`);
      if (stops.length) loadStop(0);
    };
  }

  const refresh = $("refreshBtn");
  if (refresh) refresh.onclick = () => { if (sel) sel.dispatchEvent(new Event("change")); };

  const toggleTools = $("toggleTools");
  if (toggleTools){
    toggleTools.onclick = ()=>{
      const app = $("app");
      const collapse = !app?.classList.contains("toolsCollapsed");
      if (app) app.classList.toggle("toolsCollapsed", collapse);
      toggleTools.textContent = collapse ? "Show Tools" : "Hide Tools";
      fitCanvas();
    };
  }

  window.addEventListener("resize", fitCanvas);
}

/* ---------- exported bootScenarios() ---------- */
export async function bootScenarios(){
  const info = getStorageInfo();
  setTxt("rootPill", `bucket: ${info.bucketHost} | root: ${ROOT}`);
  const user = await ensureAuthed();
  setTxt("authPill", `anon ✔ (${String(user?.uid||"anon").slice(0,8)})`);

  const sel = $("scenarioSel");
  if (sel){
    sel.innerHTML = '<option value="">Select scenario…</option>';
    scenarios = await listScenarioIds();
    scenarios.forEach(id => {
      const o=document.createElement("option");
      o.value=id; o.textContent=id; sel.appendChild(o);
    });
    setTxt("statusPill", `${scenarios.length} scenario(s)`);
    if (scenarios.length){ sel.value = scenarios[0]; sel.dispatchEvent(new Event("change")); }
  }
}

/* ---------- expose for console ---------- */
if (typeof window !== "undefined") {
  window.__SCENARIOS = { bootScenarios, wireScenarioUI };
}
export default { bootScenarios, wireScenarioUI };
