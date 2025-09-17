// scenarios.js — minimal, loud logging, no metadata filtering, immediate display
// Place this file next to your HTML. Requires firebase-core.js in the same folder
// and FabricJS already loaded before this module.

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

/* ---------------- tiny helpers ---------------- */
const $ = (id) => document.getElementById(id);
const log  = (...a) => { try{ console.log("[scenarios]", ...a); }catch(_){} };
const warn = (...a) => { try{ console.warn("[scenarios]", ...a); }catch(_){} };
function set(txtId, t){ const el=$(txtId); if (el) el.textContent=t; }

/* -------------- Canvas + <img> fallback -------------- */
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

/* ----------------- Scenario state ----------------- */
const ROOT = "scenarios";
let scenarios = [];     // [{id}]
let current   = null;   // {id}
let stops     = [];     // [{path, url, title}]
let stopIdx   = -1;

/* -------------- List scenarios (folders) -------------- */
async function listScenarioIds() {
  const { storage } = getFirebase();
  const res = await listAll(stRef(storage, ROOT));
  const ids = (res.prefixes || []).map(p => p.name);
  log("Scenario IDs:", ids);
  return ids;
}

/* -------------- List ALL files under a scenario -------------- */
async function listFilesUnderScenario(id){
  const { storage } = getFirebase();
  const base = `${ROOT}/${id}`;
  const paths = [];

  async function walk(prefix){
    const res = await listAll(stRef(storage, prefix));
    (res.items || []).forEach(it => paths.push(it.fullPath || `${prefix}/${it.name}`));
    for (const sub of (res.prefixes || [])) {
      const leaf = sub.name.toLowerCase();
      // keep simple: skip only heavy/generated folders
      if (leaf === "masks" || leaf === "overlays") continue;
      if (leaf === "results" && prefix.toLowerCase().endsWith("/ai")) continue;
      await walk(sub.fullPath || `${prefix}/${sub.name}`);
    }
  }

  await walk(base);
  log(`Found ${paths.length} item(s) under ${base}:`, paths.slice(0,12));
  return paths;
}

/* -------------- Build stops (resolve download URLs) -------------- */
async function buildStopsFromPaths(paths){
  const { storage } = getFirebase();
  const out = [];
  for (const p of paths) {
    try{
      const url = await getDownloadURL(stRef(storage, p));
      const title = p.split("/").pop() || "photo";
      out.push({ path:p, url, title });
    }catch(e){
      warn("getDownloadURL failed:", p, e?.message || e);
    }
  }
  log("stop candidates (first 6):", out.slice(0,6));
  return out;
}

/* -------------- Thumbs & image load -------------- */
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
    img.title = s.path;
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
    const blob = await tryBlobThenFetch(s);
    await setCanvasFromBlob(blob);
    set("statusPill", `Loaded: ${s.title}`);
    // Always show plain <img> fallback too:
    const fb = $("fullsizeFallback");
    if (fb){ fb.src = s.url; fb.style.display = "block"; }
  }catch(e){
    warn("loadStop error:", e);
    set("statusPill", "Load failed (showing fallback)");
    const fb = $("fullsizeFallback");
    if (fb){ fb.src = s.url; fb.style.display = "block"; }
  }

  renderThumbs();
}

async function tryBlobThenFetch(stop){
  // 1) Try SDK getBlob when we can coerce a storage ref
  try{
    const { storage } = getFirebase();
    const ref = stRef(storage, toStorageRefString(stop.path || stop.url));
    return await storageGetBlob(ref);
  }catch(_e){ /* fall through */ }

  // 2) Direct fetch (CORS)
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
    }, { crossOrigin: "anonymous" });
  });
}

/* -------------- UI wiring -------------- */
async function onScenarioChanged(){
  const sel = $("scenarioSel");
  const id = sel?.value || "";
  if (!id){ stops=[]; renderThumbs(); return; }
  current = { id };

  set("statusPill", "Listing files…");
  const paths = await listFilesUnderScenario(id);
  set("debugBox", `Paths (${paths.length})\n${paths.slice(0,12).join("\n")}${paths.length>12? "\n…" : ""}`);

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

/* expose for console debugging */
if (typeof window !== "undefined") window.__SCENARIOS = { bootScenarios };
export default { bootScenarios };
