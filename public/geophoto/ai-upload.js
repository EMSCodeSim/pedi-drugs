// ai-upload.js — "Send to AI" that always responds and visibly hits your function
// - Pings endpoints first so you see a network call even if guide building fails
// - Uses lastBaseURL fast path from scenarios.js to avoid timeouts
// - Idempotent wiring (won’t double-bind on hot reload)
// - Clear step-by-step status in #aiMsg and console

import { ensureAuthed, uploadSmallText, getFirebase } from "./firebase-core.js";
import {
  addResultAsNewStop,
  setAIStatus,
  hasOverlays as _hasOverlays,
  getCurrent,
  getGuideImageURLForCurrentStop,
  getCompositeDataURL,
  getLastLoadedBaseURL,
  isCanvasTainted
} from "./scenarios.js";

import {
  ref as stRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ========================= util & config ========================= */

const DEFAULT_ENDPOINTS = [
  "/.netlify/functions/ai-image",
  "/api/ai-image",
  // sometimes apps are hosted under a subpath like /geophoto/
  (new URL("./", location.href)).pathname.replace(/\/$/, "") + "/.netlify/functions/ai-image",
  (new URL("./", location.href)).pathname.replace(/\/$/, "") + "/api/ai-image"
].filter((u, i, a) => typeof u === "string" && u.length && a.indexOf(u) === i);

// allow overriding from the page: window.__AI_ENDPOINTS__ = ["..."]
function getCandidateEndpoints(){
  const ext = Array.isArray(window.__AI_ENDPOINTS__) ? window.__AI_ENDPOINTS__ : [];
  const arr = [...ext, ...DEFAULT_ENDPOINTS];
  // dedupe + absolutize
  const uniq = [];
  const seen = new Set();
  for (let i=0;i<arr.length;i++){
    const href = new URL(arr[i], location.origin).href;
    if (!seen.has(href)) { seen.add(href); uniq.push(href); }
  }
  return uniq;
}

function $(id){ return document.getElementById(id); }
function pick(v, d){ return (v===undefined || v===null || v==="") ? d : v; }
function hasOverlaysSafe(){ try { return !!_hasOverlays(); } catch { return false; } }

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
  const cur = getCurrent();
  const id = cur?.id || "scratch";
  const ts = Date.now();
  const path = `scenarios/${id}/ai/inbox/${ts}.${ext}`;
  await uploadBytes(stRef(storage, path), blob, {
    contentType: ext==="png" ? "image/png" : "image/jpeg",
    cacheControl: "no-store"
  });
  return await getDownloadURL(stRef(storage, path));
}

/* ========================= endpoint ping ========================= */

// We send a tiny POST {ping:true}. Any HTTP status (>=200 and <600) counts as "reachable".
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
      // many functions reply 400 to a ping; that's fine — it proves we hit the function
      console.log("[ai] ping", url, "→", r.status);
      return { url, status: r.status };
    }catch(e){
      console.warn("[ai] ping failed", url, e?.message || e);
    }
  }
  return null;
}

/* ========================= guide building ========================= */

async function guessGuideURLFast(){
  // last loaded URL from the canvas loader (instant):
  const live = getLastLoadedBaseURL();
  if (live && (/^https?:\/\//i.test(live) || live.startsWith("data:") || live.startsWith("blob:"))) {
    return live;
  }
  // guarded call into scenarios.js helper (short timeout)
  return await withTimeout(getGuideImageURLForCurrentStop(), 5000, "guideurl/timeout");
}

async function buildGuideFast({ wantComposite }){
  const guideURL = await withTimeout(guessGuideURLFast(), 6000, "guideurl/timeout");

  let compositeURL = null;
  if (wantComposite && !isCanvasTainted()){
    try{
      const dataURL = await withTimeout(getCompositeDataURL(1280, 0.92), 3000, "composite/timeout");
      const blob = await toBlobFromDataURL(dataURL);
      compositeURL = await withTimeout(uploadToInbox(blob, "jpg"), 5000, "upload/timeout");
    }catch(e){
      console.warn("[ai] composite skipped:", e?.code || e?.message || e);
    }
  }
  return { guideURL, compositeURL };
}

/* ========================= AI post ========================= */

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

/* ========================= wireAI (entry) ========================= */

export function wireAI(){
  const btnPreview = $("aiPreview");
  const btnSend    = $("aiSend");
  const btnOpen    = $("aiOpen");
  const btnAdd     = $("aiAdd");

  if (!btnPreview || !btnSend || !btnOpen || !btnAdd) {
    console.warn("[ai] Missing buttons in DOM");
    return;
  }

  // idempotent wiring (avoid double listeners)
  if (btnSend.dataset.wired === "1") {
    console.log("[ai] already wired");
    return;
  }
  btnSend.dataset.wired = "1";
  btnPreview.dataset.wired = "1";

  btnOpen.disabled = true;
  btnAdd.disabled  = true;

  btnPreview.addEventListener("click", async ()=>{
    try {
      await ensureAuthed();
      try { await uploadSmallText(`healthchecks/ai_preview_${Date.now()}.txt`, "ok"); } catch {}
      const kind  = $("aiReturn")?.value || "photo";
      const style = $("aiStyle")?.value  || "realistic";
      const notes = $("aiNotes")?.value  || "";
      setAIStatus(`Preview • return=${kind} • style=${style}${notes ? " • notes ✓" : ""}`);
    } catch (e) {
      setAIStatus("Preview failed: " + (e?.message || e));
    }
  });

  btnSend.addEventListener("click", async ()=>{
    // disable immediately to indicate UI response
    btnSend.disabled = true;
    btnOpen.disabled = true;
    btnAdd.disabled  = true;

    try{
      await ensureAuthed();

      const kind  = $("aiReturn")?.value || "photo";      // "photo" | "overlays"
      const style = $("aiStyle")?.value  || "realistic";
      const notes = $("aiNotes")?.value  || "";
      const wantComposite = (kind === "photo");

      setAIStatus("Checking AI endpoint…");
      const ping = await pingEndpoints(3500);
      if (!ping){
        setAIStatus("Could not reach AI endpoint (ping failed). Will try to send anyway…");
      } else {
        setAIStatus(`Endpoint OK (${ping.status}) — preparing guide…`);
      }

      // build guide (never stalls > 10s total)
      const { guideURL, compositeURL } = await withTimeout(
        buildGuideFast({ wantComposite }),
        10000,
        "buildguide/timeout"
      );

      if (!guideURL) throw new Error("No guideURL resolved.");

      setAIStatus("Guide ready ✓ — contacting AI…");

      const payload = {
        // canonical
        returnType: kind,
        style,
        notes: pick(notes,""),
        hasOverlays: hasOverlaysSafe(),
        guideURL,
        compositeURL,

        // common synonyms accepted by various backends
        return: kind,
        mode: (kind==="overlays" ? "overlays" : "photo"),
        overlaysOnly: kind==="overlays",
        transparent: kind==="overlays",
        style_preset: style,
        prompt: pick(notes,""),
        guideUrl: guideURL, imageURL: guideURL, image_url: guideURL, input: guideURL, reference: guideURL, src: guideURL,
        composite_url: compositeURL
      };

      const res = await postAI(payload, ping?.url);

      // Parse common result keys
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

      btnOpen.disabled = false;
      btnAdd.disabled  = false;
      btnOpen.onclick  = () => window.open(finalURL, "_blank");
      btnAdd.onclick   = async () => {
        try { await addResultAsNewStop(finalURL); setAIStatus("Result added as a new stop ✓"); }
        catch (e) { setAIStatus("Add failed: " + (e?.message || e)); }
      };

      setAIStatus("AI result ready ✓");
    } catch (e){
      console.error("[ai] send failed", e);
      // Surface the exact error to the UI so it never looks like a hang
      setAIStatus("Send failed: " + (e?.message || e));
    } finally {
      btnSend.disabled = false;
    }
  });

  console.log("[ai] wired AI buttons ✓");
  setAIStatus("AI ready");
}
