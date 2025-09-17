// ai-upload.js — minimal AI sender wired to window.__SCENARIOS and UI IDs

(function(){
  const S = window.__SCENARIOS || {};
  const $ = id => document.getElementById(id);

  const btnPreview = $("aiPreview");
  const btnSend    = $("aiSend");
  const btnOpen    = $("aiOpen");
  const btnAdd     = $("aiAdd");
  const msg        = $("aiMsg");

  let lastResultURL = null;

  function setMsg(t){ if (msg) msg.textContent = t; }
  function sanitizeStrength(v){
    const n = parseFloat(v);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
    return 0.35;
  }

  async function buildPayload(){
    if (!S.getCurrent || S.getStopIndex()==null || S.getStopIndex()<0) throw new Error("Select a photo first.");
    const returnType = ($("aiReturn")?.value || "photo");
    const style      = ($("aiStyle")?.value  || "realistic");
    const strength   = sanitizeStrength($("aiStrength")?.value || "0.35");
    const notes      = ($("aiNotes")?.value || "");

    let dataUrl = null, guideUrl = null;

    // Prefer guideUrl (robust for tainted canvases and large images)
    guideUrl = await S.getGuideImageURLForCurrentStop();

    // If not tainted and overlays exist, optionally include composited dataUrl
    if (!S.isCanvasTainted || (typeof S.isCanvasTainted === "function" && !S.isCanvasTainted())) {
      const hasOv = (S.hasOverlays && S.hasOverlays()) || false;
      if (hasOv && S.getCompositeDataURL){
        dataUrl = S.getCompositeDataURL();
      }
    }

    // Many servers expect exactly one — keep it simple: send guideUrl only
    const payload = {
      returnType, style, strength, notes,
      guideUrl // comment out the next line unless your function allows both:
      // , dataUrl
    };
    return payload;
  }

  if (btnPreview){
    btnPreview.onclick = async function(){
      try{
        const p = await buildPayload();
        setMsg("Preview → " + JSON.stringify({ ...p, notes: p.notes ? "(…)" : "" }));
      }catch(e){
        setMsg(e && (e.message || String(e)));
      }
    };
  }

  if (btnSend){
    btnSend.onclick = async function(){
      try{
        btnSend.disabled = true; btnOpen.disabled = true; btnAdd.disabled = true;
        setMsg("Uploading to AI…");
        if (S.setAIStatus) S.setAIStatus("Uploading to AI…");

        const payload = await buildPayload();
        const res = await fetch("/.netlify/functions/ai-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        let json = null;
        try { json = await res.json(); } catch(_e){}

        if (!res.ok || !json || json.ok === false){
          const err = (json && (json.error || json.message)) || ("HTTP " + res.status);
          throw new Error(err);
        }

        // Expecting { ok:true, url:"https://..." } (adjust if your function differs)
        lastResultURL = json.url || json.imageUrl || json.resultUrl || null;
        if (!lastResultURL) throw new Error("No result URL returned.");

        setMsg("AI done ✓");
        if (S.setAIStatus) S.setAIStatus("AI done ✓");
        btnOpen.disabled = false;
        btnAdd.disabled  = false;

      }catch(e){
        lastResultURL = null;
        const t = e && (e.message || String(e));
        setMsg("AI error: " + t);
        if (S.setAIStatus) S.setAIStatus("AI error: " + t);
      }finally{
        btnSend.disabled = false;
      }
    };
  }

  if (btnOpen){
    btnOpen.onclick = function(){
      if (lastResultURL) window.open(lastResultURL, "_blank", "noopener,noreferrer");
    };
  }

  if (btnAdd){
    btnAdd.onclick = async function(){
      try{
        if (!lastResultURL) throw new Error("No result to add.");
        btnAdd.disabled = true;
        setMsg("Adding as new stop…");
        if (S.addResultAsNewStop) await S.addResultAsNewStop(lastResultURL);
        setMsg("Added ✓");
      }catch(e){
        setMsg(e && (e.message || String(e)));
      }finally{
        btnAdd.disabled = false;
      }
    };
  }
})();
