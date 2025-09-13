// ai-upload.js — no-stall "Send to AI" using lastBaseURL fast path

import { ensureAuthed, uploadSmallText, getFirebase } from "./firebase-core.js";
import {
  addResultAsNewStop,
  setAIStatus,
  hasOverlays as _hasOverlays,
  getCurrent,
  getGuideImageURLForCurrentStop,   // still available
  getCompositeDataURL,               // for optional preview composite
  getLastLoadedBaseURL,              // <- NEW fast path
  isCanvasTainted                    // <- know if composite is allowed
} from "./scenarios.js";
import { ref as stRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const AI_PRIMARY  = "/api/ai-image";
const AI_FALLBACK = "/.netlify/functions/ai-image";

function $(id){ return document.getElementById(id); }
function hasOverlaysSafe(){ try { return !!_hasOverlays(); } catch { return false; } }
function pick(v, d){ return (v===undefined || v===null || v==="") ? d : v; }

// ---------- utils ----------
function withTimeout(promise, ms, label="timeout"){
  return Promise.race([
    promise,
    new Promise((_, rej)=> setTimeout(()=> rej(Object.assign(new Error(label), { code: label })), ms))
  ]);
}
async function toBlobFromDataURL(dataURL){ const r = await fetch(dataURL); return await r.blob(); }

// Upload a blob to a temp inbox path and return a download URL
async function uploadToInbox(blob, ext = "jpg"){
  const { storage } = getFirebase();
  const cur = getCurrent();
  const id = cur?.id || "scratch";
  const ts = Date.now();
  const path = `scenarios/${id}/ai/inbox/${ts}.${ext}`;
  await uploadBytes(stRef(storage, path), blob, { contentType: ext==="png" ? "image/png" : "image/jpeg", cacheControl: "no-store" });
  return await getDownloadURL(stRef(storage, path));
}

// FAST: get a usable guide URL without storage lookups if possible
async function guessGuideURLFast(){
  // 0) last URL the loader actually used (http/blob/data) — instant
  const live = getLastLoadedBaseURL();
  if (live && (/^https?:\/\//i.test(live) || live.startsWith('data:') || live.startsWith('blob:'))) return live;

  // 1) obvious fields on the current stop
  const cur = getCurrent();
  const s = cur?._stops?.[cur ? cur._stops.indexOf(cur._stops.find((x)=>x)) : -1]; // not used; we only need `cur` to exist
  // Prefer direct URLs if present
  const stop = cur?._stops?.find((_, idx) => idx === (cur._stops ? cur._stops.indexOf(cur._stops[idx]) : -1)) || null; // not needed – keep simple

  // Just call the existing helper with a short timeout (it knows about gs/path -> downloadURL)
  return await withTimeout(getGuideImageURLForCurrentStop(), 4000, "guideurl/timeout");
}

// Build guide quickly. Never stalls: overall ≤ 10s
async function buildGuideFast({ wantComposite }){
  // Always get a guide URL first (≤ 6s)
  const guideURL = await withTimeout(guessGuideURLFast(), 6000, "guideurl/timeout");

  // Optional composite preview of canvas (≤ 7s total for render+upload)
  let compositeURL = null;
  if (wantComposite && !isCanvasTainted()){
    try {
      const dataURL = await withTimeout(getCompositeDataURL(1280, 0.92), 3000, "composite/timeout");
      const blob = await toBlobFromDataURL(dataURL);
      compositeURL = await withTimeout(uploadToInbox(blob, "jpg"), 4000, "upload/timeout");
    } catch (e) {
      // Fine — we’ll proceed with guide-only
      console.warn("[ai] composite skipped:", e?.code || e?.message || e);
    }
  }
  return { guideURL, compositeURL };
}

// POST helper that surfaces server error text
async function postAI(payload){
  const headers = { "content-type": "application/json", "accept": "application/json" };
  const body = JSON.stringify(payload);

  const call = async (url) => {
    const r = await fetch(url, { method: "POST", headers, body });
    const text = await r.text();
    const ct = r.headers.get("content-type") || "";
    if (!r.ok){
      let msg = text;
      try { msg = JSON.stringify(JSON.parse(text)); } catch {}
      throw new Error(`${url} ${r.status} ${msg.slice(0, 800)}`);
    }
    if (ct.startsWith("image/")) {
      throw new Error("Function returned raw image; please return JSON {url}.");
    }
    try { return JSON.parse(text); } catch { return {}; }
  };

  try { return await call(AI_PRIMARY); }
  catch { return await call(AI_FALLBACK); }
}

export function wireAI(){
  const btnPreview = $("aiPreview");
  const btnSend    = $("aiSend");
  const btnOpen    = $("aiOpen");
  const btnAdd     = $("aiAdd");

  if (!btnPreview || !btnSend || !btnOpen || !btnAdd) {
    console.warn("[ai-upload] Missing AI buttons");
    return;
  }

  btnOpen.disabled = true;
  btnAdd.disabled  = true;

  btnPreview.onclick = async () => {
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
  };

  btnSend.onclick = async () => {
    btnSend.disabled = true;
    btnOpen.disabled = true;
    btnAdd.disabled  = true;

    try {
      await ensureAuthed();

      const kind  = $("aiReturn")?.value || "photo";      // "photo" | "overlays"
      const style = $("aiStyle")?.value  || "realistic";
      const notes = $("aiNotes")?.value  || "";
      const wantComposite = (kind === "photo");

      setAIStatus("Preparing guide…");

      // Build guide with strict timeouts so we never stall
      const { guideURL, compositeURL } = await withTimeout(
        buildGuideFast({ wantComposite }),
        10000,
        "buildguide/timeout"
      );

      setAIStatus("Guide ready ✓ — contacting AI…");

      // Tolerant payload (include common synonyms)
      const payload = {
        returnType: kind, style, notes: pick(notes,""), hasOverlays: hasOverlaysSafe(),
        return: kind, mode: (kind==="overlays"?"overlays":"photo"), overlaysOnly: kind==="overlays", transparent: kind==="overlays",
        style_preset: style, prompt: pick(notes,""),
        guideURL, guideUrl: guideURL, imageURL: guideURL, image_url: guideURL, input: guideURL, reference: guideURL, src: guideURL,
        compositeURL, composite_url: compositeURL
      };

      const res = await postAI(payload);

      // Accept a bunch of common result keys
      const url = res.url || res.result || res.image || res.output || res.image_url || res.compositeURL || res.composited_url || null;
      const dataURL = res.dataURL || res.data_url || null;

      let finalURL = null;
      if (url && /^https?:\/\//i.test(url)) {
        finalURL = url;
      } else if (dataURL && dataURL.startsWith("data:image/")) {
        const blob = await toBlobFromDataURL(dataURL);
        finalURL = await uploadToInbox(blob, dataURL.includes("png") ? "png" : "jpg");
      } else {
        throw new Error("AI did not return a URL. Received: " + JSON.stringify(res).slice(0, 500));
      }

      btnOpen.disabled = false;
      btnAdd.disabled  = false;
      btnOpen.onclick  = () => window.open(finalURL, "_blank");
      btnAdd.onclick   = async () => {
        try { await addResultAsNewStop(finalURL); setAIStatus("Result added as a new stop ✓"); }
        catch (e) { setAIStatus("Add failed: " + (e?.message || e)); }
      };

      setAIStatus("AI result ready ✓");
    } catch (e) {
      console.error("[ai-upload] send failed", e);
      setAIStatus("Send failed: " + (e?.message || e));
    } finally {
      btnSend.disabled = false;
    }
  };
}
