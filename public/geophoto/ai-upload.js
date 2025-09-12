// ai-upload.js
// Handles "Send to AI" only. No scenario reads/writes beyond the explicit add button.

import { ensureAuthed, uploadSmallText } from "./firebase-core.js";
import {
  getGuideImageURLForCurrentStop, getCompositeDataURL,
  saveResultBlobToStorage, addResultAsNewStop,
  hasOverlays, setAIStatus
} from "./scenarios.js";

const AI_PRIMARY = "/api/ai-image";
const AI_FALLBACK = "/.netlify/functions/ai-image";

async function postAI(payload) {
  try {
    setAIStatus("Calling /api/ai-image…");
    let r = await fetch(AI_PRIMARY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.status === 404) {
      setAIStatus("Calling Netlify function…");
      r = await fetch(AI_FALLBACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    return r;
  } catch (e) {
    return { ok: false, status: 0, text: async () => JSON.stringify({ ok: false, error: String(e) }) };
  }
}

function dataURLtoBlob(dataURL) {
  const [head, b64] = dataURL.split(",");
  const mime = (/data:(.*?);base64/.exec(head) || [, "application/octet-stream"])[1];
  const bin = atob(b64), len = bin.length, buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

export function wireAI() {
  const btnPreview = document.getElementById("aiPreview");
  const btnSend = document.getElementById("aiSend");
  const btnOpen = document.getElementById("aiOpen");
  const btnAdd = document.getElementById("aiAdd");

  btnOpen.disabled = true;
  btnAdd.disabled = true;

  btnPreview.onclick = async () => {
    // Lightweight debug note (optional)
    try {
      await uploadSmallText(`healthchecks/ai_preview_${Date.now()}.txt`, "ok");
      setAIStatus("Preview ready (payload will be built on send).");
    } catch (e) {
      setAIStatus("Preview note failed (non-fatal).");
    }
  };

  btnSend.onclick = async () => {
    try {
      await ensureAuthed();
      setAIStatus("Preparing…");

      const style = document.getElementById("aiStyle").value;
      const notes = (document.getElementById("aiNotes").value || "").trim();
      const prompt =
        (style === "dramatic") ? `dramatic emergency scene; ${notes}` :
        (style === "training") ? `training drill realism; ${notes}` :
                                 `photo-realistic; ${notes || "make the scene photorealistic; keep layout"}`;

      const overlayed = hasOverlays();
      let payload;
      if (overlayed) {
        setAIStatus("Compositing…");
        const composedDataUrl = await getCompositeDataURL(1600, 0.95);
        payload = { dataUrl: composedDataUrl, prompt, strength: 0.35 };
      } else {
        setAIStatus("Preparing guide image…");
        const guideUrl = await getGuideImageURLForCurrentStop();
        payload = { guideUrl, prompt, strength: 0.35 };
      }

      setAIStatus("Contacting AI…");
      const r = await postAI(payload);
      const txt = await r.text().catch(() => "");
      let json; try { json = JSON.parse(txt); } catch { json = { ok: false, error: txt || `HTTP ${r?.status || 0}` }; }

      if (!json?.ok) { setAIStatus(`AI error: ${json?.error || "Unknown"}`); return; }

      const imgField = json.image;
      let finalURL = null;

      if (typeof imgField === "string" && imgField.startsWith("data:image")) {
        setAIStatus("Uploading result…");
        const blob = dataURLtoBlob(imgField);
        finalURL = await saveResultBlobToStorage(blob);
      } else if (imgField && typeof imgField.url === "string") {
        setAIStatus("Fetching AI image…");
        const resp = await fetch(imgField.url, { mode: "cors", credentials: "omit", cache: "no-store" });
        if (!resp.ok) { setAIStatus(`AI returned a bad URL: ${imgField.url} (${resp.status})`); return; }
        const blob = await resp.blob();
        setAIStatus("Uploading result…");
        finalURL = await saveResultBlobToStorage(blob);
      } else {
        setAIStatus("No image returned.");
        return;
      }

      // Enable buttons; do not modify scenario until user clicks "Add"
      btnOpen.disabled = false;
      btnAdd.disabled = false;
      btnOpen.onclick = () => window.open(finalURL, "_blank");
      btnAdd.onclick = async () => { await addResultAsNewStop(finalURL); };

      setAIStatus("Result uploaded ✓");
    } catch (e) {
      setAIStatus(e?.message || String(e));
    }
  };
}
