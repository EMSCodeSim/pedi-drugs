// ai-upload.js — self-wiring, scenarios-agnostic, super-verbose "Send to AI"
//
// ✅ Dynamically imports scenarios module from several filenames (no hardcoded path)
// ✅ Wires buttons even if scenarios fail to load (click always responds)
// ✅ Pings Netlify function first so you can see a network request immediately
// ✅ Sends URL-based payload (guideURL + optional compositeURL)
// ✅ Clear step-by-step status in UI (#aiMsg) and console
//
// Requires: firebase-core.js in the same folder

import { ensureAuthed, uploadSmallText, getFirebase } from "./firebase-core.js";
import { ref as stRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ---------------- tiny DOM + status helpers ---------------- */
function $(id){ return document.getElementById(id); }

function updateStatus(text){
  try {
    // Prefer scenarios.js' setAIStatus when available
    if (__scn && typeof __scn.setAIStatus === "function") {
      __scn.setAIStatus(text);
      return;
    }
  } catch {}
  const el = $("aiMsg");
  if (el) el.textContent = text;
  console.log("[ai]", text);
}

function labelBtnWired(btn){
  try {
    if (!btn) return;
    btn.dataset.wired = "1";
    btn.title = "wired";
  } catch {}
}

/* ---------------- dynamic scenarios loader ---------------- */
let __scn = null; // will hold the loaded scenarios module

async function loadScenariosModule(){
  if (__scn) return __scn;

  const bases = [
    new URL(".", import.meta.url),                   // same folder as ai-upload.js
    new URL("./", location.href),                    // page folder (safety)
  ];
  const names = [
    "scenarios.js",
    "scenarios%20(1).js",
    "scenarios (1).js"
  ];

  let lastErr = null;
  for (const b of bases){
    for (const n of names){
      const u = new URL(n, b).href + "?v=" + Date.now();
      try {
        const mod = await import(u);
        // minimal export check
        if (typeof mod.getGuideImageURLForCurrentStop === "function") {
          __scn = mod;
          console.log("[ai] scenarios module loaded from", u);
          return __scn;
        } else {
          console.warn("[ai] scenarios module at", u, "missing expected exports");
        }
      } catch (e) {
        lastErr = e;
        console.warn("[ai] import fail", u, e?.message || e);
      }
    }
  }
  console.warn("[ai] Could not load scenarios module.", lastErr?.message || lastErr || "");
  __scn = null;
  return null;
}

/* ---------------- generic utils ---------------- */
function withTimeout(promise, ms, label="timeout"){
  return Promise.race([
    promise,
    new Promise((_, rej)=> setTimeout(()=> rej(Object.assign(new Error(label), { code: label })), ms))
  ]);
}

async function toBlobFromDataURL(dataURL){
  const r = await fetch(dataURL);
  return await r.blob();
}

async function uploadToInbox(blob, ext = "jpg"){
  const { storage } = getFirebase();
  let curId = "scratch";
  try {
    const cur = __scn?.getCurrent?.();
    if (cur?.id) curId = cur.id;
  } catch {}
  const ts = Date.now();
  const path = `scenarios/${curId}/ai/inbox/${ts}.${ext}`;
  await uploadBytes(stRef(storage, path), blob, {
    contentType: ext==="png" ? "image/png" : "image/jpeg",
    cacheControl: "no-store"
  });
  return await getDownloadURL(stRef(storage, path));
}

/* ---------------- endpoint discovery & ping ---------------- */
const DEFAULT_ENDPOINTS = [
  "/.netlify/functions/ai-image",
  "/api/ai-image",
  (new URL("./", location.href)).pathname.replace(/\/$/, "") + "/.netlify/functions/ai-image",
  (new URL("./", location.href)).pathname.replace(/\/$/, "") + "/api/ai-image"
].filter((u, i, a) => typeof u === "string" && u.length && a.indexOf(u) === i);

function getCandidateEndpoints(){
  const ext = Array.isArray(window.__AI_ENDPOINTS__) ? window.__AI_ENDPOINTS__ : [];
  const arr = [...ext, ...DEFAULT_ENDPOINTS];
  const uniq = [];
  const seen = new Set();
  for (let i=0;i<arr.length;i++){
    const href = new URL(arr[i], location.origin).href;
    if (!seen.has(href)) { seen.add(href); uniq.push(href); }
  }
  return uniq;
}

// POST a tiny ping {ping:true}. Any HTTP status indicates reachability.
async function pingEndpoints(timeoutMs = 4000){
  const endpoints = getCandidateEndpoints();
  const headers = { "content-type": "application/json", "x-ai-ping": "1" };
  const body = JSON.stringify({ ping: true, t: Date.now() });

  for (let i=0;i<endpoints.length;i++){
    const url = endpoints[i];
    try{
      const ctl = new AbortController();
      const tid = setTimeout(()=> ctl.abort(), timeoutMs);
      const r = await fetch(url, { method:"POST", headers, body, signal: ctl.signal, cache: "no-store", mode:"cors", credentials:"omit" });
      clearTimeout(tid);
      console.log("[ai] ping", url, "→", r.status);
      return { url, status: r.status };
    }catch(e){
      console.warn("[ai] ping failed", url, e?.message || e);
    }
  }
  return null;
}

/* ---------------- guide building (URL-first) ---------------- */
async function guessGuideURLFast(){
  // If scenarios loaded, ask it for the fastest guide
  if (__scn){
    const live = __scn.getLastLoadedBaseURL?.();
    if (live && (/^https?:\/\//i.test(live) || live.startsWith("data:") || live.startsWith("blob:"))) {
      return live;
    }
    // guarded call into helper
    return await withTimeout(__scn.getGuideImageURLForCurrentStop(), 5000, "guideurl/timeout");
  }
  throw new Error("scenarios module not loaded");
}

async function buildGuideFast({ wantComposite }){
  const guideURL = await withTimeout(guessGuideURLFast(), 6000, "guideurl/timeout");

  let compositeURL = null;
  if (wantComposite && __scn && typeof __scn.isCanvasTainted === "function" && !__scn.isCanvasTainted()){
    try{
      const dataURL = await withTimeout(__scn.getCompositeDataURL(1280, 0.92), 3000, "composite/timeout");
      const blob = await toBlobFromDataURL(dataURL);
      compositeURL = await withTimeout(uploadToInbox(blob, "jpg"), 5000, "upload/timeout");
    }catch(e){
      console.warn("[ai] composite skipped:", e?.code || e?.message || e);
    }
  }
  return { guideURL, compositeURL };
}

/* ---------------- AI POST ---------------- */
async function postAI(payload, preferredUrl){
  const endpoints = preferredUrl ? [preferredUrl, ...getCandidateEndpoints().filter(u=>u!==preferredUrl)] : getCandidateEndpoints();
  const headers = { "content-type": "application/json", "accept": "application/json" };
  const body = JSON.stringify(payload);

  for (let i=0;i<endpoints.length;i++){
    const url = endpoints[i];
    try{
      console.log("[ai] POST →", url, { keys: Object.keys(payload) });
      const ctl = new AbortController();
      const tid = setTimeout(()=> ctl.abort(), 20000);
      const r = await fetch(url, { method:"POST", headers, body, signal: ctl.signal, cache:"no-store", mode:"cors", credentials:"omit" });
      clearTimeout(tid);

      const ct = r.headers.get("content-type") || "";
      const text = await r.text();

      if (!r.ok){
        let msg = text;
        try { msg = JSON.stringify(JSON.parse(text)); } catch {}
        throw Object.assign(new Error(`${r.status} ${msg.slice(0, 800)}`), { status:r.status, url });
      }

      if (ct.startsWith("image/")){
        throw new Error("Function returned binary image. Please return JSON { url: 'https://...' }");
      }

      try {
        return { endpoint:url, json: JSON.parse(text) };
      } catch {
        return { endpoint:url, json: {} };
      }
    }catch(e){
      console.warn("[ai] POST failed", url, e?.message || e);
      // try next endpoint
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

  if (!btnSend) {
    console.warn("[ai] #aiSend not found in DOM");
    return;
  }

  // Avoid duplicate listeners
  if (btnSend.dataset.wired === "1") {
    console.log("[ai] already wired");
    return;
  }

  // baseline UI state
  if (btnOpen) btnOpen.disabled = true;
  if (btnAdd)  btnAdd.disabled  = true;

  // Preview
  if (btnPreview){
    btnPreview.addEventListener("click", async ()=>{
      try {
        await ensureAuthed();
        try { await uploadSmallText(`healthchecks/ai_preview_${Date.now()}.txt`, "ok"); } catch {}
        const kind  = $("aiReturn")?.value || "photo";
        const style = $("aiStyle")?.value  || "realistic";
        const notes = $("aiNotes")?.value  || "";
        updateStatus(`Preview • return=${kind} • style=${style}${notes ? " • notes ✓" : ""}`);
      } catch (e) {
        updateStatus("Preview failed: " + (e?.message || e));
      }
    });
    labelBtnWired(btnPreview);
  }

  // Send
  btnSend.addEventListener("click", async ()=>{
    // immediate visible response
    btnSend.disabled = true;
    if (btnOpen) btnOpen.disabled = true;
    if (btnAdd)  btnAdd.disabled  = true;

    try{
      await ensureAuthed();

      const kind  = $("aiReturn")?.value || "photo";      // "photo" | "overlays"
      const style = $("aiStyle")?.value  || "realistic";
      const notes = $("aiNotes")?.value  || "";
      const wantComposite = (kind === "photo");

      updateStatus("Checking AI endpoint…");
      const ping = await pingEndpoints(3500);
      if (!ping){
        updateStatus("Could not reach AI endpoint (ping failed). Will try to send anyway…");
      } else {
        updateStatus(`Endpoint OK (${ping.status}) — preparing guide…`);
      }

      // Ensure scenarios loaded (so we can resolve guide URL)
      if (!__scn) {
        await loadScenariosModule();
      }
      if (!__scn) {
        throw new Error("Scenarios module not loaded; cannot resolve guide image.");
      }

      const { guideURL, compositeURL } = await withTimeout(
        buildGuideFast({ wantComposite }),
        10000,
        "buildguide/timeout"
      );

      if (!guideURL) throw new Error("No guideURL resolved.");

      updateStatus("Guide ready ✓ — contacting AI…");

      const hasOv = (()=>{ try { return !!__scn?.hasOverlays?.(); } catch { return false; } })();

      const payload = {
        // canonical
        returnType: kind,
        style,
        notes: notes || "",
        hasOverlays: hasOv,
        guideURL,
        compositeURL,

        // common synonyms
        return: kind,
        mode: (kind==="overlays" ? "overlays" : "photo"),
        overlaysOnly: kind==="overlays",
        transparent: kind==="overlays",
        style_preset: style,
        prompt: notes || "",
        guideUrl: guideURL, imageURL: guideURL, image_url: guideURL, input: guideURL, reference: guideURL, src: guideURL,
        composite_url: compositeURL
      };

      const res = await postAI(payload, ping?.url);

      // Parse result
      const j = res.json || {};
      const url = j.url || j.result || j.image || j.output || j.image_url || j.compositeURL || j.composited_url || null;
      const dataURL = j.dataURL || j.data_url || null;

      let finalURL = null;
      if (url && /^https?:\/\//i.test(url)) {
        finalURL = url;
      } else if (dataURL && dataURL.startsWith("data:image/")) {
        const blob = await toBlobFromDataURL(dataURL);
        finalURL = await uploadToInbox(blob, dataURL.includes("png") ? "png" : "jpg");
      } else {
        throw new Error("AI did not return a URL. Received keys: " + Object.keys(j).join(", "));
      }

      if (btnOpen) {
        btnOpen.disabled = false;
        btnOpen.onclick  = () => window.open(finalURL, "_blank");
      }
      if (btnAdd) {
        btnAdd.disabled  = false;
        btnAdd.onclick   = async () => {
          try { await __scn.addResultAsNewStop(finalURL); updateStatus("Result added as a new stop ✓"); }
          catch (e) { updateStatus("Add failed: " + (e?.message || e)); }
        };
      }

      updateStatus("AI result ready ✓");
    } catch (e){
      console.error("[ai] send failed", e);
      updateStatus("Send failed: " + (e?.message || e));
    } finally {
      btnSend.disabled = false;
    }
  });

  labelBtnWired(btnSend);
  labelBtnWired($("aiOpen"));
  labelBtnWired($("aiAdd"));

  console.log("[ai] wired AI buttons ✓");
  updateStatus("AI ready");
}

/* ---------------- auto-init (idempotent) ---------------- */
function start(){
  try {
    bindButtons();
  } catch (e) {
    console.error("[ai] bind error", e);
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once:true });
} else {
  // already loaded
  setTimeout(start, 0);
}

/* ---------------- optional: expose debug hooks ---------------- */
window.__AI_DEBUG = {
  reloadScenarios: async () => { __scn = null; return await loadScenariosModule(); },
  ping: pingEndpoints,
  endpoints: getCandidateEndpoints
};
