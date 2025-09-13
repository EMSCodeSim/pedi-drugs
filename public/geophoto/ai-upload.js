// ai-upload.js
// Handles the AI panel: Preview / Send / Open / Add
// Works with scenarios.js + firebase-core.js (split-file setup)

import { ensureAuthed, uploadSmallText } from "./firebase-core.js";
import {
  getGuideImageURLForCurrentStop,
  getCompositeDataURL,
  saveResultBlobToStorage,
  addResultAsNewStop,
  setAIStatus,
  // hasOverlays is optional; if not exported we soft-fallback below
  hasOverlays as _hasOverlaysOptional
} from "./scenarios.js";

const AI_PRIMARY = "/api/ai-image";
const AI_FALLBACK = "/.netlify/functions/ai-image";

// ---------- helpers ----------
function $(id){ return document.getElementById(id); }
function hasOverlaysSafe(){
  try { return typeof _hasOverlaysOptional === "function" ? _hasOverlaysOptional() : false; }
  catch { return false; }
}
async function toBlobFromDataURL(dataURL){
  const res = await fetch(dataURL);
  return await res.blob();
}
function pick(val, fallback){ return (val===undefined || val===null || val==="") ? fallback : val; }

async function postAI(payload) {
  const headers = { "content-type": "application/json" };
  const body = JSON.stringify(payload);

  // Try primary, then fallback
  let r;
  try {
    r = await fetch(AI_PRIMARY, { method: "POST", headers, body });
    if (!r.ok) throw new Error("primary " + r.status);
  } catch (e) {
    r = await fetch(AI_FALLBACK, { method: "POST", headers, body });
    if (!r.ok) throw new Error("fallback " + r.status);
  }

  // If the function returns an image directly, capture as blob
  const ct = r.headers.get("content-type") || "";
  if (ct.startsWith("image/")) {
    const blob = await r.blob();
    return { type: "image", blob };
  }

  // Otherwise expect JSON with at least { url } or { dataURL }
  const j = await r.json().catch(() => ({}));
  return { type: "json", json: j };
}

// Try a few “safe” ways to get something we can send the AI:
// - Prefer guide image URL (download URL from storage).
// - Optionally composite of current canvas (if not cross-origin tainted).
async function buildGuide({ wantComposite }) {
  try {
    if (wantComposite) {
      // getCompositeDataURL throws if canvas is tainted (we handle below)
      const dataURL = await getCompositeDataURL(1600, 0.95);
      const blob = await toBlobFromDataURL(dataURL);
      return { kind: "composite", blob, dataURL };
    }
  } catch (e) {
    // Fall through to guide URL path
  }

  // Fallback: a direct guide image URL (doesn’t taint canvas)
  const guideURL = await getGuideImageURLForCurrentStop();
  return { kind: "guideURL", url: guideURL };
}

// ---------- main wiring ----------
export function wireAI(){
  const btnPreview = $("aiPreview");
  const btnSend    = $("aiSend");
  const btnOpen    = $("aiOpen");
  const btnAdd     = $("aiAdd");

  if (!btnPreview || !btnSend || !btnOpen || !btnAdd) {
    console.warn("[ai-upload] missing AI buttons in DOM");
    return;
  }

  // initial state
  btnOpen.disabled = true;
  btnAdd.disabled  = true;

  btnPreview.onclick = async () => {
    try {
      await ensureAuthed();
      // lightweight healthcheck write (optional)
      try {
        await uploadSmallText(`healthchecks/ai_preview_${Date.now()}.txt`, "ok");
      } catch {}
      const kind  = $("aiReturn")?.value || "photo";
      const style = $("aiStyle")?.value  || "realistic";
      const notes = $("aiNotes")?.value  || "";
      const overlayFlag = hasOverlaysSafe();

      setAIStatus(`Preview: return=${kind}, style=${style}, overlays=${overlayFlag ? "yes" : "no"}${notes ? " | notes ✓" : ""}`);
    } catch (e) {
      setAIStatus("Preview failed: " + (e?.message || e));
    }
  };

  btnSend.onclick = async () => {
    // guard against double clicks
    btnSend.disabled = true;
    btnOpen.disabled = true;
    btnAdd.disabled  = true;

    try {
      await ensureAuthed();

      const kind  = $("aiReturn")?.value || "photo";      // "photo" | "overlays"
      const style = $("aiStyle")?.value  || "realistic";  // "realistic" | "dramatic" | "training"
      const notes = $("aiNotes")?.value  || "";

      // Build “guide” material:
      // - If kind=photo, we prefer a local composite (if allowed), else guide URL
      // - If kind=overlays, we only pass a guide URL + intent (server should return transparent PNG)
      const wantComposite = (kind === "photo");
      setAIStatus("Preparing guide…");
      const guide = await buildGuide({ wantComposite });

      // Construct payload for the function (keep this generic & tolerant)
      const payload = {
        returnType: kind,         // "photo" or "overlays"
        style: style,             // stylistic hint
        notes: pick(notes, ""),   // free text notes
        hasOverlays: !!hasOverlaysSafe()
      };

      if (guide.kind === "guideURL") {
        payload.guideURL = guide.url;
      } else if (guide.kind === "composite") {
        // Send as base64 to keep a single POST (avoids separate upload permissioning)
        const b64 = await new Promise((resolve, reject)=>{
          const reader = new FileReader();
          reader.onerror = reject;
          reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
          reader.readAsDataURL(guide.blob);
        });
        payload.compositeBase64 = b64; // image/jpeg base64
      }

      setAIStatus("Contacting AI…");
      const res = await postAI(payload);

      // Interpret the response
      let finalURL = null;

      if (res.type === "image") {
        // Image blob directly returned → upload to storage for a permanent URL
        setAIStatus("Uploading result…");
        const url = await saveResultBlobToStorage(res.blob);
        finalURL = url;
      } else if (res.type === "json") {
        const j = res.json || {};
        // Prefer explicit url; else accept dataURL (upload it); else error
        if (j.url && /^https?:\/\//i.test(j.url)) {
          finalURL = j.url;
        } else if (j.dataURL && j.dataURL.startsWith("data:image/")) {
          const blob = await toBlobFromDataURL(j.dataURL);
          finalURL = await saveResultBlobToStorage(blob);
        } else if (j.result && /^https?:\/\//i.test(j.result)) {
          finalURL = j.result;
        } else {
          throw new Error("AI did not return a result URL.");
        }
      }

      // Enable buttons; allow user to open/add the result
      btnOpen.disabled = false;
      btnAdd.disabled  = false;
      btnOpen.onclick  = () => window.open(finalURL, "_blank");
      btnAdd.onclick   = async () => { try { await addResultAsNewStop(finalURL); setAIStatus("Result added as a new stop ✓"); } catch (e) { setAIStatus("Add failed: " + (e?.message||e)); } };

      setAIStatus("AI result ready ✓");
    } catch (e) {
      console.error("[ai-upload] send failed", e);
      setAIStatus("Send failed: " + (e?.message || e));
    } finally {
      btnSend.disabled = false;
    }
  };
}
