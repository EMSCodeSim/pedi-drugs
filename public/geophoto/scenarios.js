// scenarios.js — minimal, loud logging, no metadata filtering, immediate display
// Requires firebase-core.js in the same folder and FabricJS already loaded.

import {
  getFirebase,
  ensureAuthed,
  getStorageInfo,
  toStorageRefString,
  candidateOriginals,
} from "./firebase-core.js";

import {
  ref as stRef,
  listAll,
  getDownloadURL,
  getBlob as storageGetBlob,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const $ = (id) => document.getElementById(id);
const log  = (...a) => { try{ console.log("[scenarios]", ...a); }catch(_){} };
const warn = (...a) => { try{ console.warn("[scenarios]", ...a); }catch(_){} };

function set(txtId, t){ const el=$(txtId); if (el) el.textContent=t; }

/* ---------- Canvas + fallback <img> ---------- */
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

/* ---------- List scenarios (folders) ---------- */
const ROOT = "scenarios";
let scenarios = [];  // [{id}]
let current   = null;
let stops     = [];  // [{path, url, title}]
let stopIdx   = -1;

async function listScenarioIds() {
  const { storage } = getFirebase();
  const res = await listAll(stRef(storage, ROOT));
  const ids = (res.prefixes || []).map(p => p.name);
  log("Scenario IDs:", ids);
  return ids;
}

/* ---------- List files under a scenario (no filtering) ---------- */
async function listFilesUnderScenario(id){
  const { storage } = getFirebase();
  const base = `${ROOT}/${id}`;
  const paths = [];
  async function walk(prefix){
    const res = await listAll(stRef(storage, prefix));
    (res.items || []).forEach(it => paths.push(it.fullPath || `${prefix}/${it.name}`));
    for (const sub of (res.prefixes || [])) {
      // skip masks/overlays/ai/results folders only
      const leaf = sub.name.toLowerCase();
      if (leaf === "masks" || leaf === "overlays") continue;
      if (prefix.endsWith("/ai") || leaf === "ai") { /* we'll include ai root but skip results */ }
      if (leaf === "results" && prefix.toLowerCase().endsWith("/ai")) continue;
      await walk(sub.fullPath || `${prefix}/${sub.name}`);
    }
  }
  await walk(base);
  log(`Found ${paths.length} item(s) under ${base}:`, paths.slice(0,10));
  return paths;
}

/* ---------- Build stops → download URLs ---------- */
async function buildStopsFromPaths(paths){
  const { storage } = getFirebase();
  const out = [];
  for (const p of paths) {
    try{
      const url = await getDownloadURL(stRef(storage, p));
      const title = p.split("/").pop() || "photo";
      out.push({ path: p, url, title });
    }catch(e){
      warn("getDownloadURL failed:", p, e?.message || e);
    }
  }
  log("stop candidates (first 5):", out.slice(0,5));
  return out;
}

/* ---------- Render thumbnails & first image ---------- */
function renderThumbs(){
  const row = $("thumbRow"); if (!row) return;
  row.innerHTML = "";
  if (!stops.length){
    row.innerHTML = '<div class="pill small">No photos/slides</div>';
    return;
  }
  for (let i=0;i<stops.length;i++){
    const s = stops[i];
    const img = document.createElement("img");
    img.className = "thumb" + (i===stopIdx ? " active":"");
    img.src = s.url;
    img.alt = s.title;
    img.onerror = () => { img.style.opacity = 0.5; img.title = "thumb load error"; };
    img.onclick = () => loadStop(i);
    row.appendChild(img);
  }
}

async function loadStop(i){
  stopIdx = i;
  const s = stops[i]; if (!s) return;
  set("statusPill", `Loading: ${s.title}`);
  try{
    ensureCanvas();
    const imgBlob = await tryBlobThenFetch(s.url);
    await setCanvasFromBlob(imgBlob);
    set("statusPill", `Loaded: ${s.title}`);
    // Also show plain <img> fallback so you ALWAYS see something:
    const fb = $("fullsizeFallback");
    if (fb){ fb.src = s.url; fb.style.display = "block"; }
  }catch(e){
    warn("loadStop error:", e);
    set("statusPill", "Load failed");
    const fb = $("fullsizeFallback");
    if (fb){ fb.src = s.url; fb.style.display = "block"; }
  }
  renderThumbs();
}

async function tryBlobThenFetch(url){
  // 1) SDK getBlob if the url is a storage path
  try{
    const { storage } = getFirebase();
    const r = stRef(storage, toStorageRefString(url));
    return await storageGetBlob(r);
  }catch(_){}
  // 2) fetch
  const r = await fetch(url, { mode:"cors", cache:"force-cache" });
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
    }, { crossOrigin: "anonymous" });
  });
}

/* ---------- UI wiring ---------- */
async function onScenarioChanged(){
  const sel = $("scenarioSel");
  const id = sel?.value || "";
  if (!id){ stops=[]; renderThumbs(); return; }
  current = { id };
  set("statusPill", "Listing files…");
  const paths = await listFilesUnderScenario(id);
  set("debugBox", `Paths (${paths.length})\n${paths.slice(0,8).join("\n")}${paths.length>8? "\n…" : ""}`);
  if (!paths.length){
    stops=[]; renderThumbs();
    set("statusPill","No images found in this storage folder.");
    return;
  }
  set("statusPill","Resolving URLs…");
  stops = await buildStopsFromPaths(paths);
  renderThumbs();
  set("statusPill", `${stops.length} file(s) resolved`);
  if (stops.length) loadStop(0);
}

export async function bootScenarios(){
  // show bucket & auth
  const info = getStorageInfo();
  set("rootPill", `bucket: ${info.bucketHost} | root: ${ROOT}`);
  const user = await ensureAuthed();
  set("authPill", `anon ✔ (${String(user?.uid||"anon").slice(0,8)})`);

  // fill scenario select
  const sel = $("scenarioSel");
  sel.innerHTML = '<option value="">Select scenario…</option>';
  const ids = await listScenarioIds();
  ids.forEach(id => {
    const o=document.createElement("option");
    o.value=id; o.textContent=id; sel.appendChild(o);
  });
  set("statusPill", `${ids.length} scenario(s)`);

  sel.onchange = onScenarioChanged;
  if (ids.length){ sel.value = ids[0]; sel.dispatchEvent(new Event("change")); }

  const refresh = $("refreshBtn");
  if (refresh) refresh.onclick = ()=> sel.dispatchEvent(new Event("change"));
}

if (typeof window !== "undefined") window.__SCENARIOS = { bootScenarios };
export default { bootScenarios };
