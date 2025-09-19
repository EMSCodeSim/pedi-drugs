// scenarios.js — Storage-only scenario loader + image display (canvas + <img> fallback)

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

/* -------- tiny helpers -------- */
const $ = (id) => document.getElementById(id);
const setTxt = (id, t) => { const el=$(id); if (el) el.textContent=t; };
const log  = (...a) => { try{ console.log("[scenarios]", ...a); }catch(_){} };
const warn = (...a) => { try{ console.warn("[scenarios]", ...a); }catch(_){} };

/* -------- canvas + fallback <img> -------- */
let f=null, baseImage=null;
function ensureCanvas(){
  if (f) return f;
  if (!window.fabric) { warn("fabric missing; using <img> fallback only"); return null; }
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

/* -------- state -------- */
const ROOT_CANDIDATES = ["scenarios", "geophoto/scenarios"]; // try both
let ACTIVE_ROOT = "scenarios";
let scenarios = [];          // scenario ids (folder names)
let currentId = "";
let stops = [];              // [{path,url,title}]
let stopIdx = -1;

/* ===================== Storage listing ===================== */
/**
 * Firebase "folders" are prefixes. Depending on how files were uploaded,
 * listAll(root).prefixes may be empty even if objects exist at root/<id>/...
 * This function derives IDs from BOTH prefixes and first segments of item paths.
 */
async function listScenarioIdsForRoot(root){
  const { storage } = getFirebase();

  // Ensure trailing slash to hint "directory"
  const normRoot = root.replace(/\/+$/,"");
  const rootRef = stRef(storage, normRoot + "/");

  const res = await listAll(rootRef);
  console.log("[DEBUG] listAll result for", normRoot, {
    prefixes: (res.prefixes || []).map(p => ({ name: p.name, fullPath: p.fullPath })),
    itemsLen: (res.items || []).length,
    sampleItems: (res.items || []).slice(0,5).map(i => i.fullPath)
  });

  const ids = new Set();

  // Prefer explicit subfolder prefixes
  (res.prefixes || []).forEach(p => {
    if (p?.name) ids.add(p.name);
    else if (p?.fullPath) {
      const parts = p.fullPath.split("/").filter(Boolean);
      const leaf = parts[parts.length - 1];
      if (leaf) ids.add(leaf);
    }
  });

  // Fallback: derive from items (e.g., scenarios/<id>/file.jpg)
  (res.items || []).forEach(item => {
    const fp = (item.fullPath || "").replace(/^\/+/,"");
    const parts = fp.split("/").filter(Boolean);
    // Cases to handle:
    //  - "scenarios/<id>/file.jpg"
    //  - "<id>/file.jpg" (if provider omitted the root)
    const idx = (parts[0] === normRoot && parts.length > 1) ? 1 : 0;
    const candidate = parts[idx];
    if (candidate && candidate !== normRoot) ids.add(candidate);
  });

  const out = Array.from(ids).sort();
  console.log("[DEBUG] Scenario IDs found:", out);
  return out;
}

async function pickActiveRoot(){
  for (const root of ROOT_CANDIDATES){
    try {
      const ids = await listScenarioIdsForRoot(root);
      if (ids.length) { ACTIVE_ROOT = root; return ids; }
      // If zero, keep trying next root
    } catch (e){
      warn("Root check failed for", root, e?.message||e);
      // try next
    }
  }
  // default
  ACTIVE_ROOT = ROOT_CANDIDATES[0];
  return [];
}

async function listFilesUnderScenario(id){
  const { storage } = getFirebase();
  const base = `${ACTIVE_ROOT}/${id}`.replace(/\/+/g,"/");
  const paths = [];
  async function walk(prefix){
    const res = await listAll(stRef(storage, prefix + "/"));
    (res.items || []).forEach(it => paths.push(it.fullPath || `${prefix}/${it.name}`));
    for (const sub of (res.prefixes || [])) {
      const leaf = (sub.name || "").toLowerCase();
      // skip only big/generated folders
      if (leaf === "masks" || leaf === "overlays") continue;
      if (leaf === "results" && prefix.toLowerCase().endsWith("/ai")) continue;
      await walk((sub.fullPath || `${prefix}/${sub.name}`).replace(/\/+/g,"/"));
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
    }catch(e){ warn("getDownloadURL:", p, e?.code || e?.message || e); }
  }
  return out;
}

/* ===================== UI rendering ===================== */
function renderScenarioSelect(){
  const sel = $("scenarioSel");
  if (!sel) return;
  sel.innerHTML = '<option value="">Select scenario…</option>';
  for (const id of scenarios){
    const o = document.createElement("option");
    o.value = id; o.textContent = id;
    sel.appendChild(o);
  }
}

function renderThumbs(){
  const row = $("thumbRow"); if (!row) return;
  row.innerHTML = "";
  if (!stops.length){ row.innerHTML = '<div class="pill small">No photos/slides</div>'; return; }
  stops.forEach((s,i)=>{
    const img = document.createElement("img");
    img.className = "thumb" + (i===stopIdx?" active":"");
    img.src = s.url; img.alt = s.title; img.title = s.path;
    img.onclick = () => loadStop(i);
    img.onerror = () => { img.style.opacity=0.5; img.title="thumb load error"; };
    row.appendChild(img);
  });
}

async function loadStop(i){
  stopIdx = i;
  const s = stops[i]; if (!s) return;
  setTxt("statusPill", `Loading: ${s.title}`);
  try{
    const blob = await tryBlobThenFetch(s);
    await setCanvasFromBlob(blob);          // canvas if available
    const fb = $("fullsizeFallback");       // always show the <img> too
    if (fb){ fb.src = s.url; fb.style.display = "block"; }
    setTxt("statusPill", `Loaded: ${s.title}`);
  }catch(e){
    warn("loadStop error:", e);
    const fb = $("fullsizeFallback");
    if (fb){ fb.src = s.url; fb.style.display = "block"; }
    setTxt("statusPill", "Load failed (fallback shown)");
    const errbar = $("errbar");
    if (errbar){ errbar.style.display="block"; errbar.textContent = `Load error: ${e?.code||e?.message||e}`; }
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
  const canvas = ensureCanvas();
  if (!canvas) return; // no fabric; rely on <img> fallback
  return new Promise((res,rej)=>{
    const u = URL.createObjectURL(blob);
    fabric.Image.fromURL(u, (img)=>{
      if (!img){ URL.revokeObjectURL(u); rej(new Error("fabric null")); return; }
      baseImage = img; img.set({ selectable:false, evented:false });
      canvas.clear(); canvas.add(img); img.moveTo(0); fitCanvas(); canvas.requestRenderAll();
      URL.revokeObjectURL(u); res();
    }, { crossOrigin:"anonymous" });
  });
}

/* ===================== Exports ===================== */
export function wireScenarioUI(){
  const sel = $("scenarioSel");
  if (sel){
    sel.onchange = async () => {
      currentId = sel.value || "";
      if (!currentId){ stops=[]; renderThumbs(); return; }
      setTxt("statusPill","Listing files…");
      try{
        const paths = await listFilesUnderScenario(currentId);
        setTxt("debug", `<b>Paths (${paths.length})</b><br>${paths.slice(0,24).map(p=>p).join("<br>")}${paths.length>24? "<br>…" : ""}`);
        if (!paths.length){ stops=[]; renderThumbs(); setTxt("statusPill","No images found."); return; }
        setTxt("statusPill","Resolving URLs…");
        stops = await buildStopsFromPaths(paths);
        renderThumbs();
        setTxt("statusPill", `${stops.length} file(s) resolved`);
        if (stops.length) loadStop(0);
      }catch(e){
        const errbar = $("errbar");
        if (errbar){ errbar.style.display="block"; errbar.textContent = `List error: ${e?.code||e?.message||e}`; }
        setTxt("statusPill", "Failed to list files (see console).");
        warn("listFilesUnderScenario error:", e);
      }
    };
  }
  const refresh = $("refreshBtn");
  if (refresh) refresh.onclick = () => { if (sel) sel.dispatchEvent(new Event("change")); };
  const toggleTools = $("toggleTools");
  if (toggleTools){
    toggleTools.onclick = ()=>{
      const app = $("app");
      const collapsed = !app?.classList.contains("toolsCollapsed");
      if (app) app.classList.toggle("toolsCollapsed", collapsed);
      toggleTools.textContent = collapsed ? "Show Tools" : "Hide Tools";
      fitCanvas();
    };
  }
  window.addEventListener("resize", fitCanvas);
}

export async function bootScenarios(setStatus = ()=>{}, showError = ()=>{}){
  try{
    const info = getStorageInfo();
    setTxt("rootPill", `bucket: ${info.bucketHost} | root: (detecting…)`);

    const user = await ensureAuthed();
    setTxt("authPill", `anon ✔ (${String(user?.uid||"anon").slice(0,8)})`);

    // Detect active root by trying both candidates
    scenarios = [];
    for (const root of ROOT_CANDIDATES) {
      try {
        const ids = await listScenarioIdsForRoot(root);
        if (ids.length) { ACTIVE_ROOT = root; scenarios = ids; break; }
      } catch (e) { warn("root try failed", root, e); }
    }

    setTxt("rootPill", `bucket: ${info.bucketHost} | root: ${ACTIVE_ROOT}`);
    renderScenarioSelect();
    setTxt("statusPill", `${scenarios.length} scenario(s)`);

    const sel = $("scenarioSel");
    if (sel && scenarios.length){
      sel.value = scenarios[0];
      sel.dispatchEvent(new Event("change"));
    }
    if (!scenarios.length){
      const errbar = $("errbar");
      if (errbar){
        errbar.style.display = "block";
        errbar.textContent = `No scenario folders found under "${ACTIVE_ROOT}". Ensure your Storage rules allow read/list for '${ACTIVE_ROOT}/**' and that folders exist.`;
      }
    }
  }catch(e){
    warn("bootScenarios error:", e);
    setTxt("statusPill", "Failed to list scenarios (see console).");
    const errbar = $("errbar");
    if (errbar){
      errbar.style.display = "block";
      errbar.textContent = `Boot error: ${e?.code || e?.message || e}`;
    }
  }
}

/* -------- auto-boot (kept) -------- */
function autoBoot(){
  try{
    wireScenarioUI();
    bootScenarios();
  }catch(e){ warn("autoBoot error:", e); }
}
if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", autoBoot, { once:true });
}else{
  autoBoot();
}

/* expose for console */
if (typeof window !== "undefined") window.__SCENARIOS = { bootScenarios, wireScenarioUI };
export default { bootScenarios, wireScenarioUI };
