// ai-upload.js — robust AI wiring (URL-first payload + detailed errors)

import { ensureAuthed, uploadSmallText, getFirebase } from "./firebase-core.js";
import {
  getGuideImageURLForCurrentStop,
  getCompositeDataURL,
  addResultAsNewStop,
  setAIStatus,
  hasOverlays as _hasOverlays,
  getCurrent
} from "./scenarios.js";
import { ref as stRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const AI_PRIMARY  = "/api/ai-image";
const AI_FALLBACK = "/.netlify/functions/ai-image";

function $(id){ return document.getElementById(id); }
function hasOverlaysSafe(){ try { return !!_hasOverlays(); } catch { return false; } }
function pick(v, d){ return (v===undefined || v===null || v==="") ? d : v; }

async function toBlobFromDataURL(dataURL){ const r = await fetch(dataURL); return await r.blob(); }

// Upload a blob to a temp “inbox” path so we can pass a URL to the AI function
async function uploadToInbox(blob, ext = "jpg"){
  const { storage } = getFirebase();
  const cur = getCurrent();
  const id = cur?.id || "scratch";
  const ts = Date.now();
  const path = `scenarios/${id}/ai/inbox/${ts}.${ext}`;
  await uploadBytes(stRef(storage, path), blob, { contentType: ext==="png" ? "image/png" : "image/jpeg", cacheControl: "no-store" });
  return await getDownloadURL(stRef(storage, path));
}

// Prefer URL payloads (smaller, avoids function body size limits)
async function buildGuide({ wantComposite }){
  // Always provide a guideURL
  const guideURL = await getGuideImageURLForCurrentStop();

  // Optionally also provide a compositeURL (uploaded preview of canvas) if possible
  let compositeURL = null;
  if (wantComposite) {
    try {
      const dataURL = await getCompositeDataURL(1280, 0.92);
      const blob = await toBlobFromDataURL(dataURL);
      compositeURL = await uploadToInbox(blob, "jpg");
    } catch {
      // Canvas might be tainted (or user didn’t edit) — that’s fine, we’ll just send guideURL
    }
  }
  return { guideURL, compositeURL };
}

// POST helper that shows detailed error text instead of just “400”
async function postAI(payload){
  const headers = { "content-type": "application/json", "accept": "application/json" };
  const body = JSON.stringify(payload);

  const tryEndpoint = async (url) => {
    const r = await fetch(url, { method: "POST", headers, body });
    const ct = r.headers.get("content-type") || "";
    const text = await r.text(); // read once

    if (!r.ok) {
      // try to surface JSON error messages if any
      let errMsg = text;
      try { errMsg = JSON.stringify(JSON.parse(text)); } catch {}
      throw new Error(`${url} ${r.status} ${errMsg.slice(0, 800)}`);
    }

    if (ct.startsWith("image/")) {
      // Convert previously-read text back into a Blob is tricky; instead, re-fetch the URL via a signed redirect if provided.
      // Most functions won’t inline binary with text path. If yours does, adapt here to stream the response instead of reading text.
      throw new Error("Function returned image with text body; please return JSON {url} or stream the image.");
    }

    try { return { type: "json", json: JSON.parse(text) }; }
    catch { return { type: "json", json: {} }; }
  };

  try {
    return await tryEndpoint(AI_PRIMARY);
  } catch (e1) {
    // fall back
    return await tryEndpoint(AI_FALLBACK);
  }
}

export function wireAI(){
  const btnPreview = $("aiPreview");
  const btnSend    = $("aiSend");
  const btnOpen    = $("aiOpen");
  const btnAdd     = $("aiAdd");

  if (!btnPreview || !btnSend || !btnOpen || !btnAdd) {
    console.warn("[ai-upload] Missing buttons");
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
      setAIStatus(`Preview ready • return=${kind} • style=${style}${notes ? " • notes ✓" : ""}`);
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
      const { guideURL, compositeURL } = await buildGuide({ wantComposite });

      // Build a very tolerant payload (lots of synonyms)
      const payload = {
        // canonical
        returnType: kind,                // "photo" | "overlays"
        style,
        notes: pick(notes, ""),
        hasOverlays: hasOverlaysSafe(),

        // synonyms many server funcs accept
        return: kind,
        mode: kind === "overlays" ? "overlays" : "photo",
        overlaysOnly: kind === "overlays",
        transparent: kind === "overlays",
        style_preset: style,
        prompt: pick(notes, ""),

        // guide URL (many aliases)
        guideURL, guideUrl: guideURL, imageURL: guideURL, image_url: guideURL,
        input: guideURL, reference: guideURL, src: guideURL,

        // optional composite URL (preview of canvas)
        compositeURL,
        composite_url: compositeURL
      };

      setAIStatus("Contacting AI…");
      const res = await postAI(payload);

      // Expect JSON with a result URL or dataURL
      const j = res.json || {};
      const url = j.url || j.result || j.image || j.output || j.image_url || j.composited_url || j.compositeURL || null;
      const dataURL = j.dataURL || j.data_url || null;

      let finalURL = null;
      if (url && /^https?:\/\//i.test(url)) {
        finalURL = url;
      } else if (dataURL && dataURL.startsWith("data:image/")) {
        // Upload dataURL to storage to get a durable URL
        const blob = await toBlobFromDataURL(dataURL);
        finalURL = await uploadToInbox(blob, dataURL.includes("png") ? "png" : "jpg");
      } else {
        throw new Error("AI did not return a URL. Received: " + JSON.stringify(j).slice(0, 500));
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
      setAIStatus(String(e?.message || e));
    } finally {
      btnSend.disabled = false;
    }
  };
}
