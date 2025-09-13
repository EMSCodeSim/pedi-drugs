// ai-upload.js — exports wireAI(), attaches to existing scenarios, robust result parsing
// - Accepts { ok, image, mode } where `image` may be absolute URL, relative URL, dataURL, or raw base64
// - Pings Netlify endpoint first so a network call is always visible
// - Auto-selects first stop if none selected, verbose status

import { ensureAuthed, uploadSmallText, getFirebase } from "./firebase-core.js";
import { ref as stRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ---------------- DOM + status helpers ---------------- */
function $(id){ return document.getElementById(id); }
let __scn = (typeof window !== "undefined" && window.__SCENARIOS) || null;

function updateStatus(text){
  try{ if (__scn && typeof __scn.setAIStatus === "function"){ __scn.setAIStatus(text); return; } }catch{}
  const el = $("aiMsg"); if (el) el.textContent = text;
  console.log("[ai]", text);
}
function labelBtnWired(btn){ try{ if (btn){ btn.dataset.wired="1"; btn.title="wired"; } }catch{} }

/* ---------------- obtain scenarios instance (reuse first, then import) ---------------- */
async function loadScenariosModule(){
  if (__scn) return __scn;

  if (typeof window !== "undefined" && window.__SCENARIOS){
    __scn = window.__SCENARIOS;
    console.log("[ai] attached to window.__SCENARIOS");
    return __scn;
  }

  const bases = [ new URL(".", import.meta.url), new URL("./", location.href) ];
  const names = ["scenarios.js","scenarios (1).js","scenarios%20(1).js"]; // no cache-busting to avoid forking module
  let lastErr=null;

  for (const b of bases){
    for (const n of names){
      const u = new URL(n, b).href;
      try{
        const mod = await import(u);
        if (typeof window !== "undefined" && window.__SCENARIOS){
          __scn = window.__SCENARIOS;
          console.log("[ai] imported & attached via window.__SCENARIOS from", u);
          return __scn;
        }
        if (typeof mod.getGuideImageURLForCurrentStop === "function"){
          __scn = mod;
          console.log("[ai] imported scenarios module from", u);
          return __scn;
        }
      }catch(e){ lastErr = e; console.warn("[ai] scenarios import fail", u, e?.message||e); }
    }
  }
  console.warn("[ai] Could not load scenarios module.", lastErr?.message||lastErr||"");
  __scn = null;
  return null;
}

/* ---------------- utils ---------------- */
function withTimeout(promise, ms, label="timeout"){
  return Promise.race([
    promise,
    new Promise((_,rej)=> setTimeout(()=> rej(Object.assign(new Error(label),{code:label})), ms))
  ]);
}
async function toBlobFromDataURL(dataURL){ const r=await fetch(dataURL); return await r.blob(); }
async function uploadToInbox(blob, ext="jpg"){
  const { storage } = getFirebase();
  let curId="scratch";
  try{ const cur = __scn?.getCurrent?.(); if (cur?.id) curId=cur.id; }catch{}
  const ts=Date.now();
  const path=`scenarios/${curId}/ai/inbox/${ts}.${ext}`;
  await uploadBytes(stRef(storage, path), blob, { contentType: ext==="png"?"image/png":"image/jpeg", cacheControl:"no-store" });
  return await getDownloadURL(stRef(storage, path));
}

/* ---------------- endpoint discovery & ping ---------------- */
const DEFAULT_ENDPOINTS = [
  "/.netlify/functions/ai-image",
  "/api/ai-image",
  (new URL("./", location.href)).pathname.replace(/\/$/, "") + "/.netlify/functions/ai-image",
  (new URL("./", location.href)).pathname.replace(/\/$/, "") + "/api/ai-image"
].filter((u,i,a)=> typeof u==="string" && u.length && a.indexOf(u)===i);

function getCandidateEndpoints(){
  const ext = Array.isArray(window.__AI_ENDPOINTS__) ? window.__AI_ENDPOINTS__ : [];
  const arr = [...ext, ...DEFAULT_ENDPOINTS];
  const seen=new Set(), out=[];
  for (const u of arr){ const href=new URL(u, location.origin).href; if(!seen.has(href)){ seen.add(href); out.push(href); } }
  return out;
}

async function pingEndpoints(timeoutMs=4000){
  const endpoints = getCandidateEndpoints();
  const headers = { "content-type":"application/json", "x-ai-ping":"1" };
  const body = JSON.stringify({ ping:true, t:Date.now() });
  for (const url of endpoints){
    try{
      const ctl=new AbortController(); const tid=setTimeout(()=>ctl.abort(), timeoutMs);
      const r = await fetch(url, { method:"POST", headers, body, signal:ctl.signal, cache:"no-store", mode:"cors", credentials:"omit" });
      clearTimeout(tid);
      console.log("[ai] ping", url, "→", r.status);
      return { url, status:r.status };
    }catch(e){ console.warn("[ai] ping failed", url, e?.message||e); }
  }
  return null;
}

/* ---------------- ensure a stop is selected (auto-open #0) ---------------- */
async function ensureStopSelectedOrAutoOpen(){
  if (!__scn) await loadScenariosModule();
  if (!__scn) { updateStatus("No scenarios module — cannot resolve guide image."); return false; }

  const cur = __scn.getCurrent?.();
  const idx = __scn.getStopIndex?.();

  if (!cur){ updateStatus("Select a scenario from the dropdown first."); return false; }
  if (idx != null && idx >= 0) return true;

  const stops = cur._stops;
  if (Array.isArray(stops) && stops.length){
    updateStatus("No stop selected — opening first photo…");
    try{ await __scn.loadStop?.(0); return true; }
    catch(e){ updateStatus("Could not open first stop: " + (e?.message||e)); return false; }
  }
  updateStatus("This scenario has no photos/slides.");
  return false;
}

/* ---------------- guide building (URL-first) ---------------- */
async function guessGuideURLFast(){
  const live = __scn?.getLastLoadedBaseURL?.();
  if (live && (/^https?:\/\//i.test(live) || live.startsWith("data:") || live.startsWith("blob:"))) return live;
  return await withTimeout(__scn.getGuideImageURLForCurrentStop(), 5000, "guideurl/timeout");
}
async function buildGuideFast({ wantComposite }){
  const guideURL = await withTimeout(guessGuideURLFast(), 6000, "guideurl/timeout");
  let compositeURL = null;
  if (wantComposite && __scn?.isCanvasTainted && !__scn.isCanvasTainted()){
    try{
      const dataURL = await withTimeout(__scn.getCompositeDataURL(1280, 0.92), 3000, "composite/timeout");
      const blob = await toBlobFromDataURL(dataURL);
      compositeURL = await withTimeout(uploadToInbox(blob, "jpg"), 5000, "upload/timeout");
    }catch(e){ console.warn("[ai] composite skipped:", e?.code||e?.message||e); }
  }
  return { guideURL, compositeURL };
}

/* ---------------- Result normalization ---------------- */
function looksLikeBase64Image(s){
  if (typeof s !== "string" || s.length < 32) return false;
  // Common starts: JPEG "/9j/", PNG "iVBORw0KGgo", GIF "R0lGOD", WebP "UklGR"
  return s.startsWith("/9j/") || s.startsWith("iVBORw0") || s.startsWith("R0lGOD") || s.startsWith("UklGR");
}

// Accepts many shapes and resolves to either a final absolute URL or a dataURL
async function normalizeAIResponse(json, endpoint){
  const ep = endpoint || location.origin;

  // 1) Direct candidates (strings or nested objects)
  const pool = [];
  const push = (v)=>{ if (v==null) return; if (typeof v === "string" || (typeof v === "object" && v.url)) pool.push(v); };

  push(json.url);
  push(json.result);
  push(json.output);
  push(json.image_url);
  push(json.image);
  push(json.href);
  push(json.link);
  push(json.compositeURL);
  push(json.composited_url);

  // If `image` was an object like {url:"...", mime:"image/png"}
  for (let i=0;i<pool.length;i++){
    const item = pool[i];
    const val = (typeof item === "object" && item.url) ? item.url : item;
    if (typeof val !== "string") continue;

    if (/^https?:\/\//i.test(val)) return { finalURL: val };
    if (val.startsWith("data:image/")) return { dataURL: val };

    // relative path?
    if (val.startsWith("/") || val.startsWith("./") || val.startsWith("../")){
      try{ return { finalURL: new URL(val, ep).href }; }catch{}
    }

    // raw base64?
    if (looksLikeBase64Image(val)) {
      const mime = (typeof item === "object" && item.mime) ? item.mime : "image/jpeg";
      return { dataURL: `data:${mime};base64,${val}` };
    }
  }

  // 2) Explicit base64/data keys
  const b64 = json.dataURL || json.data_url || json.base64 || json.b64 || json.imageBase64 || json.image_b64 || json.output_b64;
  if (typeof b64 === "string" && b64.length){
    if (b64.startsWith("data:image/")) return { dataURL: b64 };
    const mime = json.mime || json.contentType || "image/jpeg";
    return { dataURL: `data:${mime};base64,${b64}` };
  }

  // 3) Some functions reply {ok:true} only (no asset) — treat as error
  return null;
}

/* ---------------- AI POST ---------------- */
async function postAI(payload, preferredUrl){
  const endpoints = preferredUrl ? [preferredUrl, ...getCandidateEndpoints().filter(u=>u!==preferredUrl)] : getCandidateEndpoints();
  const headers = { "content-type":"application/json", "accept":"application/json" };
  const body = JSON.stringify(payload);

  for (const url of endpoints){
    try{
      console.log("[ai] POST →", url, { keys:Object.keys(payload) });
      const ctl=new AbortController(); const tid=setTimeout(()=>ctl.abort(), 20000);
      const r = await fetch(url, { method:"POST", headers, body, signal:ctl.signal, cache:"no-store", mode:"cors", credentials:"omit" });
      clearTimeout(tid);

      const ct = r.headers.get("content-type") || "";
      const text = await r.text();

      if (!r.ok){
        let msg = text; try{ msg = JSON.stringify(JSON.parse(text)); }catch{}
        throw Object.assign(new Error(`${r.status} ${msg.slice(0,800)}`), { status:r.status, url });
      }
      if (ct.startsWith("image/")) throw new Error("Function returned binary image. Return JSON { url: 'https://...' }");

      let json = {};
      try{ json = JSON.parse(text); }catch{}
      return { endpoint:url, json };
    }catch(e){
      console.warn("[ai] POST failed", url, e?.message||e);
      // try next
    }
  }
  throw new Error("All AI endpoints failed.");
}

/* ---------------- main wiring ---------------- */
function bindButtons(){
  const btnPreview = $("aiPreview");
  const btnSend    = $("aiSend");
  const btnOpen    = $("aiOpen");
  const btnAdd     = $("aiAdd");

  if (!btnSend){ console.warn("[ai] #aiSend not found"); return; }
  if (btnSend.dataset.wired === "1"){ console.log("[ai] already wired"); return; }

  if (btnOpen) btnOpen.disabled = true;
  if (btnAdd)  btnAdd.disabled  = true;

  // Preview
  if (btnPreview){
    btnPreview.addEventListener("click", async ()=>{
      try{
        await ensureAuthed();
        try{ await uploadSmallText(`healthchecks/ai_preview_${Date.now()}.txt`, "ok"); }catch{}
        const kind  = $("aiReturn")?.value || "photo";
        const style = $("aiStyle")?.value  || "realistic";
        const notes = $("aiNotes")?.value  || "";
        updateStatus(`Preview • return=${kind} • style=${style}${notes ? " • notes ✓" : ""}`);
      }catch(e){ updateStatus("Preview failed: " + (e?.message||e)); }
    });
    labelBtnWired(btnPreview);
  }

  // Send
  btnSend.addEventListener("click", async ()=>{
    btnSend.disabled = true; if (btnOpen) btnOpen.disabled = true; if (btnAdd) btnAdd.disabled = true;

    try{
      await ensureAuthed();

      const kind  = $("aiReturn")?.value || "photo";
      const style = $("aiStyle")?.value  || "realistic";
      const notes = $("aiNotes")?.value  || "";
      const wantComposite = (kind === "photo");

      updateStatus("Checking AI endpoint…");
      const ping = await pingEndpoints(3500);
      if (!ping) updateStatus("Could not reach AI endpoint (ping failed). Trying anyway…");
      else       updateStatus(`Endpoint OK (${ping.status}) — preparing guide…`);

      if (!__scn) await loadScenariosModule();
      if (!(await ensureStopSelectedOrAutoOpen())) throw new Error("Select a scenario + photo/slide first.");

      const { guideURL, compositeURL } = await withTimeout(
        buildGuideFast({ wantComposite }),
        10000,
        "buildguide/timeout"
      );
      if (!guideURL) throw new Error("No guideURL resolved.");

      updateStatus("Guide ready ✓ — contacting AI…");

      const hasOv = (()=>{ try { return !!__scn?.hasOverlays?.(); } catch { return false; } })();

      const payload = {
        returnType: kind, style, notes: notes||"", hasOverlays: hasOv,
        guideURL, compositeURL,
        // synonyms for varied backends
        return: kind, mode: (kind==="overlays"?"overlays":"photo"),
        overlaysOnly: kind==="overlays", transparent: kind==="overlays",
        style_preset: style, prompt: notes||"",
        guideUrl: guideURL, imageURL: guideURL, image_url: guideURL, input: guideURL, reference: guideURL, src: guideURL,
        composite_url: compositeURL
      };

      const res = await postAI(payload, ping?.url);
      const norm = await normalizeAIResponse(res.json || {}, res.endpoint);

      if (!norm){
        const keys = Object.keys(res.json || {}).join(", ") || "(no keys)";
        throw new Error("AI did not return a usable image. Received keys: " + keys);
      }

      let finalURL = null;
      if (norm.finalURL){
        finalURL = norm.finalURL;
      } else if (norm.dataURL){
        const blob = await toBlobFromDataURL(norm.dataURL);
        const ext  = norm.dataURL.includes("png") ? "png" : "jpg";
        finalURL = await uploadToInbox(blob, ext);
      }

      if (!finalURL) throw new Error("Could not resolve final image URL.");

      if (btnOpen){ btnOpen.disabled=false; btnOpen.onclick=()=> window.open(finalURL,"_blank"); }
      if (btnAdd){  btnAdd.disabled=false;  btnAdd.onclick=async ()=>{ try{ await __scn.addResultAsNewStop(finalURL); updateStatus("Result added as a new stop ✓"); }catch(e){ updateStatus("Add failed: " + (e?.message||e)); } }; }

      updateStatus("AI result ready ✓");
    }catch(e){
      console.error("[ai] send failed", e);
      updateStatus("Send failed: " + (e?.message || e));
    }finally{
      btnSend.disabled = false;
    }
  });

  labelBtnWired(btnSend); labelBtnWired(btnOpen); labelBtnWired(btnAdd);
  console.log("[ai] wired AI buttons ✓");
  updateStatus("AI ready");
}

/* ---------------- export + auto-init ---------------- */
export function wireAI(){ bindButtons(); }
function start(){ try{ bindButtons(); }catch(e){ console.error("[ai] bind error", e); } }
if (document.readyState === "loading"){ document.addEventListener("DOMContentLoaded", start, { once:true }); }
else { setTimeout(start, 0); }

// Debug hooks
window.__AI_DEBUG = {
  reloadScenarios: async () => { __scn = null; return await loadScenariosModule(); },
  ping: pingEndpoints,
  endpoints: getCandidateEndpoints
};
