// scenarios.js — Advanced Editor (secure + single-file friendly)
// - Single-file via:
//     ?path=scenarios/<id>/<file>
//     ?file=<downloadURL>   (encoded OR unencoded; will auto-stitch token)
// - Auth-first boot (works with rules requiring request.auth != null)
// - If not single-file, falls back to robust scenario listing

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

/* -------------------- small helpers -------------------- */
const $ = (id) => document.getElementById(id);
const setTxt = (id, t) => { const el=$(id); if (el) el.textContent=t; };
const log  = (...a) => { try{ console.log("[scenarios]", ...a); }catch(_){} };
const warn = (...a) => { try{ console.warn("[scenarios]", ...a); }catch(_){} };

const TIMEOUT_MS = 6000;
function withTimeout(p, ms=TIMEOUT_MS, label="timeout"){
  return Promise.race([
    p,
    new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(new Error(label),{code:label})), ms))
  ]);
}

/* -------------------- canvas + fallback <img> -------------------- */
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

/* -------------------- state -------------------- */
const ROOT_CANDIDATES = ["scenarios", "geophoto/scenarios"];
let ACTIVE_ROOT = "scenarios";
let scenarios = [];   // scenario ids (folder names)
let currentId = "";
let stops = [];       // [{path,url,title}]
let stopIdx = -1;

/* -------------------- single-file mode -------------------- */
// Parse query params but also allow grabbing the raw tail after "?file="
function getQueryParams(){
  try { return new URLSearchParams(location.search); }
  catch { return new URLSearchParams(); }
}

// Accept both encoded and unencoded ?file= URLs.
// If browser split token/alt params, reattach them.
function getSingleFileURLFromQuery(){
  const qp = getQueryParams();

  // 1) Prefer a clean ?path= (we'll resolve to URL)
  const storagePath = qp.get("path");
  if (storagePath) return { type:"path", value: decodeURIComponent(storagePath) };

  // 2) Try normal ?file=
  let file = qp.get("file");
  if (file) {
    file = decodeURIComponent(file);
    // If token or alt got split into their own params, add them back
    const hasTokenInUrl = /[?&]token=/.test(file);
    const hasAltInUrl   = /[?&]alt=/.test(file);
    const token = qp.get("token");
    const alt   = qp.get("alt");
    const url = new URL(file, location.href);
    if (!hasAltInUrl && alt) url.searchParams.set("alt", alt);
    if (!hasTokenInUrl && token) url.searchParams.set("token", token);
    return { type:"url", value: url.toString() };
  }

  // 3) Last resort: if the current href contains "?file=" followed by an unencoded URL,
  // grab everything after "?file=" (handles cases where extra params were not parsed).
  const href = String(location.href);
  const idx = href.indexOf("?file=");
  if (idx >= 0) {
    let tail = href.slice(idx + 6);        // after "?file="
    // If there are our page's own params preceding file, guard by '&file=' too
    const ampIdx = tail.indexOf("&file=");
    if (ampIdx >= 0) tail = tail.slice(ampIdx + 6);
    // decode once; leave any remaining encoded pieces as-is
    try { tail = decodeURIComponent(tail); } catch {}
    return { type:"url", value: tail };
  }

  return null;
}

async function loadSingleFileIfRequested(){
  const spec = getSingleFileURLFromQuery();
  if (!spec) return false;

  let stop;
  if (spec.type === "url"){
    stop = { path: spec.value, url: spec.value, title: (spec.value.split("/").pop()||"").split("?")[0] || "photo" };
  } else if (spec.type === "path"){
    try{
      const { storage } = getFirebase();
      const url = await getDownloadURL(stRef(storage, spec.value));
      stop = { path: spec.value, url, title: spec.value.split("/").pop() || "photo" };
    }catch(e){
      const errbar = $("errbar");
      if (errbar){ errbar.style.display="block"; errbar.textContent = `Failed to resolve ?path: ${e?.code||e?.message||e}`; }
      return true; // attempted single-file; keep normal UI hidden
    }
  }

  // Hide scenario UI
  const sel = $("scenarioSel"); if (sel) sel.disabled = true;
  const header = document.querySelector(".scenario-header"); if (header) header.style.display="none";

  stops = [stop];
  stopIdx = 0;
  setTxt("statusPill","Single-file mode");
  renderThumbs();
  await loadStop(0);
  return true;
}

/* -------------------- storage listing (when not single-file) -------------------- */
async function sdkListPrefixesAt(storage, prefixPath){
  const res = await withTimeout(listAll(stRef(storage, prefixPath)), TIMEOUT_MS, "storage/list-timeout");
  const ids = new Set();
  (res.prefixes || []).forEach(p => {
    const leaf = p?.name || (p?.fullPath?.split("/").filter(Boolean).slice(-1)[0]);
    if (leaf) ids.add(leaf);
  });
  (res.items || []).forEach(item => {
    const fp = (item.fullPath || "").replace(/^\/+/,"");
    const parts = fp.split("/").filter(Boolean);
    if (!parts.length) return;
    let idx = 0;
    if (parts[0] === "scenarios" && parts.length > 1) idx = 1;
    else if (parts[0] === "geophoto" && parts[1] === "scenarios" && parts.length > 2) idx = 2;
    const id = parts[idx];
    if (id && id !== "scenarios") ids.add(id);
  });
  return Array.from(ids);
}

async function restListPrefixes(bucketHost, prefix){
  const q = new URLSearchParams({ prefix: prefix.endsWith("/")?prefix:prefix+"/", delimiter:"/" }).toString();
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucketHost}/o?${q}`;
  const r = await withTimeout(fetch(url, { mode:"cors", cache:"no-store" }), TIMEOUT_MS, "rest/list-timeout");
  if (!r.ok) throw new Error(`rest list HTTP ${r.status}`);
  const j = await r.json();
  const prefixes = Array.isArray(j.prefixes) ? j.prefixes : [];
  return prefixes.map(p => p.split("/").filter(Boolean).pop()).filter(Boolean);
}

async function sweepByFirstChar(storage, root){
  const chars = ["-"]; for (let i=48;i<=57;i++) chars.push(String.fromCharCode(i));
  for (let i=65;i<=90;i++) chars.push(String.fromCharCode(i));
  for (let i=97;i<=122;i++) chars.push(String.fromCharCode(i));
  const found = new Set();
  for (const ch of chars){
    try{ (await sdkListPrefixesAt(storage, `${root}/${ch}`)).forEach(x=>found.add(x)); }catch(_){}
  }
  return Array.from(found);
}

async function listScenarioIdsForRoot(root){
  const { storage } = getFirebase();
  const { bucketHost } = getStorageInfo();
  const normRoot = root.replace(/\/+$/,"");

  try{
    const ids = await sdkListPrefixesAt(storage, normRoot + "/");
    if (ids.length) { log("IDs via SDK root:", ids); return ids.sort(); }
  }catch(e){ warn("SDK root list failed:", e?.code||e?.message||e); }

  try{
    const ids2 = await restListPrefixes(bucketHost, normRoot);
    if (ids2.length) { log("IDs via REST:", ids2); return ids2.sort(); }
  }catch(e){ warn("REST list failed:", e?.code||e?.message||e); }

  try{
    const ids3 = await sweepByFirstChar(storage, normRoot);
    if (ids3.length) { log("IDs via sweep:", ids3); return ids3.sort(); }
  }catch(e){ warn("Sweep failed:", e?.code||e?.message||e); }

  return [];
}

async function pickActiveRoot(){
  for (const root of ROOT_CANDIDATES){
    try {
      const ids = await listScenarioIdsForRoot(root);
      if (ids.length) { ACTIVE_ROOT = root; return ids; }
    } catch (e){ warn("Root check failed for", root, e?.message||e); }
  }
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

/* -------------------- UI rendering -------------------- */
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
    await setCanvasFromBlob(blob);
    const fb = $("fullsizeFallback");
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
  if (!canvas) return;
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

/* -------------------- exports -------------------- */
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

    // Secure rules require auth (Anonymous sign-in enabled)
    const user = await ensureAuthed();
    setTxt("authPill", `anon ✔ (${String(user?.uid||"anon").slice(0,8)})`);

    // >>> Single-file mode takes precedence <<<
    const handled = await loadSingleFileIfRequested();
    if (handled) {
      setTxt("rootPill", `bucket: ${info.bucketHost} | single-file`);
      return; // skip listing entirely
    }

    // Otherwise, detect a root and list scenarios
    scenarios = [];
    for (const root of ROOT_CANDIDATES) {
      setTxt("statusPill", `Booting ${root}…`);
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
        errbar.textContent = `No scenario folders found under "${ACTIVE_ROOT}". (Auth required; check rules & App Check.)`;
      }
    }
  }catch(e){
    warn("bootScenarios error:", e);
    setTxt("statusPill", "Failed to boot scenarios (see console).");
    const errbar = $("errbar");
    if (errbar){
      errbar.style.display = "block";
      errbar.textContent = `Boot error: ${e?.code || e?.message || e}`;
    }
  }
}

/* -------------------- auto-boot -------------------- */
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
