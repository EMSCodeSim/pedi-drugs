/* ai-upload.legacy.js — classic browser script (no modules, no Node/process)
   - Uses window.__SCENARIOS if present (no dynamic imports)
   - Posts to /.netlify/functions/ai-image and finishes when a JSON with an image arrives
   - Handles JSON, SSE/NDJSON-ish progress, absolute/relative URLs, data URLs, raw base64
   - Optional: adds result as a new stop if #aiAdd is present
*/

(function(){
  "use strict";

  /* ---------- small utils ---------- */
  function $(id){ return document.getElementById(id); }
  function log(){ try{ console.log.apply(console, ["[ai]"].concat([].slice.call(arguments))); }catch{} }
  function warn(){ try{ console.warn.apply(console, ["[ai]"].concat([].slice.call(arguments))); }catch{} }

  var __scn = (typeof window !== "undefined" && window.__SCENARIOS) || null;

  function updateStatus(text){
    try{ if (__scn && typeof __scn.setAIStatus === "function"){ __scn.setAIStatus(text); return; } }catch(e){}
    var el = $("aiMsg"); if (el) el.textContent = text;
    log(text);
  }

  function withTimeout(promise, ms, label){
    if (!label) label = "timeout";
    var t;
    return Promise.race([
      promise,
      new Promise(function(_res, rej){
        t = setTimeout(function(){ var err = new Error(label); err.code = label; rej(err); }, ms);
      })
    ]).finally(function(){ try{ clearTimeout(t); }catch(e){} });
  }

  /* ---------- scenarios instance (legacy: just use global) ---------- */
  function getScenarios(){
    if (__scn) return __scn;
    if (typeof window !== "undefined" && window.__SCENARIOS){
      __scn = window.__SCENARIOS;
    }
    return __scn;
  }

  /* ---------- ensure a stop is selected ---------- */
  async function ensureStopSelectedOrAutoOpen(){
    var scn = getScenarios();
    if (!scn){ updateStatus("No scenarios module — cannot resolve guide image."); return false; }

    var cur = null, idx = null;
    try{ cur = scn.getCurrent && scn.getCurrent(); }catch(e){}
    try{ idx = scn.getStopIndex && scn.getStopIndex(); }catch(e){}

    if (!cur){ updateStatus("Select a scenario from the dropdown first."); return false; }
    if (idx != null && idx >= 0) return true;

    var stops = cur._stops;
    if (Array.isArray(stops) && stops.length){
      updateStatus("No stop selected — opening first photo…");
      try{ scn.loadStop && await scn.loadStop(0); return true; }
      catch(e){ updateStatus("Could not open first stop: " + (e && (e.message||e))); return false; }
    }
    updateStatus("This scenario has no photos/slides.");
    return false;
  }

  /* ---------- guide & composite ---------- */
  async function guessGuideURLFast(){
    var scn = getScenarios();
    if (!scn) throw new Error("no scenarios");
    try{
      var live = scn.getLastLoadedBaseURL && scn.getLastLoadedBaseURL();
      if (live && (/^https?:\/\//i.test(live) || String(live).startsWith("data:") || String(live).startsWith("blob:"))) return live;
    }catch(e){}
    return await withTimeout(scn.getGuideImageURLForCurrentStop(), 5000, "guideurl/timeout");
  }

  async function buildGuideAndDataUrl(){
    var scn = getScenarios();
    var guideURL = await withTimeout(guessGuideURLFast(), 6000, "guideurl/timeout");
    var dataUrl = null;

    try{
      if (scn && scn.isCanvasTainted && !scn.isCanvasTainted()){
        // some builds expose getCompositeDataURL(w, quality) → returns data:image/...
        dataUrl = await withTimeout(scn.getCompositeDataURL(1600, 0.95), 5000, "composite/timeout");
      }else{
        warn("Canvas tainted or not available; will send guideURL instead of dataUrl.");
      }
    }catch(e){
      warn("Composite dataUrl failed:", e && (e.code||e.message||e));
      dataUrl = null;
    }
    return { guideURL: guideURL, dataUrl: dataUrl };
  }

  /* ---------- endpoint helpers ---------- */
  var DEFAULT_ENDPOINTS = [
    "/.netlify/functions/ai-image",
    "/api/ai-image"
  ];

  function getCandidateEndpoints(){
    var ext = Array.isArray(window.__AI_ENDPOINTS__) ? window.__AI_ENDPOINTS__ : [];
    var arr = ext.concat(DEFAULT_ENDPOINTS);
    var seen = {}, out=[];
    for (var i=0;i<arr.length;i++){
      try{
        var href = new URL(arr[i], location.origin).href;
        if (!seen[href]){ seen[href] = 1; out.push(href); }
      }catch(e){}
    }
    return out;
  }

  async function pingEndpoints(timeoutMs){
    if (!timeoutMs) timeoutMs = 4000;
    var endpoints = getCandidateEndpoints();
    var headers = { "content-type":"application/json", "x-ai-ping":"1" };
    var body = JSON.stringify({ ping:true, t:Date.now() });
    for (var i=0;i<endpoints.length;i++){
      var url = endpoints[i];
      try{
        var ctl = new AbortController();
        var tid = setTimeout(function(){ try{ ctl.abort(); }catch(e){} }, timeoutMs);
        var r = await fetch(url, { method:"POST", headers:headers, body:body, signal:ctl.signal, cache:"no-store", mode:"cors", credentials:"omit" });
        clearTimeout(tid);
        log("ping", url, "→", r.status);
        return { url:url, status:r.status };
      }catch(e){
        warn("ping failed", url, e && (e.message||e));
      }
    }
    return null;
  }

  /* ---------- normalize AI response ---------- */
  function looksLikeBase64Image(s){
    if (typeof s !== "string" || s.length < 32) return false;
    return s.indexOf("/9j/") === 0 || s.indexOf("iVBORw0") === 0 || s.indexOf("R0lGOD") === 0 || s.indexOf("UklGR") === 0;
  }

  async function normalizeAIResponse(json, endpoint){
    var ep = endpoint || location.origin;
    var pool = [];
    function push(v){ if (v==null) return; if (typeof v === "string" || (typeof v === "object" && v.url)) pool.push(v); }

    push(json.url); push(json.result); push(json.output); push(json.image_url);
    push(json.image); push(json.href); push(json.link);
    push(json.compositeURL); push(json.composited_url);

    for (var i=0;i<pool.length;i++){
      var item = pool[i];
      var val = (typeof item === "object" && item.url) ? item.url : item;
      if (typeof val !== "string") continue;
      if (/^https?:\/\//i.test(val)) return { finalURL: val };
      if (val.indexOf("data:image/") === 0) return { dataURL: val };
      if (val.indexOf("/") === 0 || val.indexOf("./") === 0 || val.indexOf("../") === 0){
        try{ return { finalURL: new URL(val, ep).href }; }catch(e){}
      }
      if (looksLikeBase64Image(val)){
        var mime = (typeof item === "object" && item.mime) ? item.mime : "image/jpeg";
        return { dataURL: "data:" + mime + ";base64," + val };
      }
    }

    var b64 = json.dataURL || json.data_url || json.base64 || json.b64 || json.imageBase64 || json.image_b64 || json.output_b64;
    if (typeof b64 === "string" && b64.length){
      if (b64.indexOf("data:image/") === 0) return { dataURL: b64 };
      var mime2 = json.mime || json.contentType || "image/jpeg";
      return { dataURL: "data:" + mime2 + ";base64," + b64 };
    }
    return null;
  }

  /* ---------- POST to function (with streaming-friendly parsing) ---------- */
  async function postAI(payload, preferredUrl){
    var endpoints = preferredUrl ? [preferredUrl].concat(getCandidateEndpoints().filter(function(u){ return u!==preferredUrl; })) : getCandidateEndpoints();
    var headers = { "content-type":"application/json", "accept":"application/json,text/event-stream,text/plain,application/x-ndjson" };
    var body = JSON.stringify(payload);

    for (var i=0;i<endpoints.length;i++){
      var url = endpoints[i];
      try{
        log("POST →", url, "keys:", Object.keys(payload||{}));
        var ctl = new AbortController();
        var HARD_MS = 120000;
        var hardTimer = setTimeout(function(){ try{ ctl.abort(); }catch(e){} }, HARD_MS);

        var r = await fetch(url, { method:"POST", headers:headers, body:body, signal:ctl.signal, cache:"no-store", mode:"cors", credentials:"omit" });

        if (!r.ok){
          clearTimeout(hardTimer);
          var txt = ""; try{ txt = await r.text(); }catch(e){}
          var msg = txt; try{ msg = JSON.stringify(JSON.parse(txt)); }catch(e){}
          throw new Error(r.status + " " + (msg||""));
        }

        var ct = (r.headers.get("content-type") || "").toLowerCase();

        // Non-streaming JSON path
        if (ct.indexOf("application/json") >= 0 && r.body == null){
          clearTimeout(hardTimer);
          var text = await withTimeout(r.text(), 15000, "json/timeout");
          var out={}; try{ out = JSON.parse(text); }catch(e){}
          return { endpoint:url, json: out };
        }

        // Streaming / unknown-length path
        var reader = r.body && r.body.getReader ? r.body.getReader() : null;
        if (!reader){
          var text2 = await withTimeout(r.text(), 15000, "stream/timeout");
          clearTimeout(hardTimer);
          var out2={}; try{ out2 = JSON.parse(text2); }catch(e){}
          return { endpoint:url, json: out2 };
        }

        updateStatus("AI: streaming…");
        var decoder = new TextDecoder();
        var buf = "";
        var IDLE_MS = 6000;
        var idleTimer = setTimeout(function(){ try{ ctl.abort(); }catch(e){} }, IDLE_MS);
        function resetIdle(){ try{ clearTimeout(idleTimer); }catch(e){} idleTimer = setTimeout(function(){ try{ ctl.abort(); }catch(e){} }, IDLE_MS); }

        // Read chunks, look for JSON lines; finish when an image/url appears
        while (true){
          var step = await reader.read();
          resetIdle();
          if (step.done) break;
          var chunk = decoder.decode(step.value, { stream:true });
          buf += chunk;

          var lines = buf.split(/\r?\n/); buf = lines.pop();
          for (var li=0; li<lines.length; li++){
            var raw = lines[li];
            var line = raw.replace(/^data:\s*/,'').trim();
            if (!line) continue;
            if (line.charAt(0) !== "{"){ updateStatus("AI: " + line.slice(0,120)); continue; }
            try{
              var j = JSON.parse(line);
              if (j.status || ("progress" in j)){
                var pct = (typeof j.progress === "number") ? (" " + Math.round(j.progress*100) + "%") : "";
                updateStatus("AI: " + (j.status || "working") + pct);
              }
              if (j.image || j.url || j.result || j.output || j.dataURL || j.data_url || j.image_url || j.compositeURL){
                try{ clearTimeout(hardTimer); clearTimeout(idleTimer); }catch(e){}
                try{ await reader.cancel(); }catch(e){}
                return { endpoint:url, json:j };
              }
            }catch(e){}
          }
        }

        try{ clearTimeout(hardTimer); clearTimeout(idleTimer); }catch(e){}
        var tail = (buf||"").trim();
        if (tail){
          try{ return { endpoint:url, json: JSON.parse(tail) }; }catch(e){}
        }
        throw new Error("AI stream ended with no JSON (empty body).");
      }catch(e){
        warn("POST failed", url, e && (e.message||e));
        updateStatus("AI endpoint failed, trying next…");
      }
    }
    throw new Error("All AI endpoints failed.");
  }

  /* ---------- main wiring ---------- */
  function wireAI(){
    var btnPreview = $("aiPreview");
    var btnSend    = $("aiSend");
    var btnOpen    = $("aiOpen");
    var btnAdd     = $("aiAdd");

    if (!btnSend){ warn("#aiSend not found"); return; }
    if (btnSend.dataset && btnSend.dataset.wired === "1"){ log("already wired"); return; }

    if (btnOpen) btnOpen.disabled = true;
    if (btnAdd)  btnAdd.disabled  = true;

    // Preview (optional healthcheck)
    if (btnPreview){
      btnPreview.addEventListener("click", function(){
        try{
          var kind  = ($("aiReturn") && $("aiReturn").value) || "photo";
          var style = ($("aiStyle") && $("aiStyle").value)  || "realistic";
          var notes = ($("aiNotes") && $("aiNotes").value)  || ( $("aiPrompt") && $("aiPrompt").value ) || "";
          var strength = parseFloat( ($("aiStrength") && $("aiStrength").value) || "0.35" ) || 0.35;
          updateStatus("Preview • return=" + kind + " • style=" + style + " • strength=" + strength + (notes ? " • notes ✓" : ""));
        }catch(e){ updateStatus("Preview failed: " + (e && (e.message||e))); }
      });
      btnPreview.dataset && (btnPreview.dataset.wired = "1");
    }

    // Send
    btnSend.addEventListener("click", async function(){
      if (btnSend) btnSend.disabled = true; if (btnOpen) btnOpen.disabled = true; if (btnAdd) btnAdd.disabled = true;

      try{
        var kind      = ($("aiReturn") && $("aiReturn").value) || "photo";
        var style     = ($("aiStyle") && $("aiStyle").value)  || "realistic";
        var prompt    = ($("aiNotes") && $("aiNotes").value)  || ( $("aiPrompt") && $("aiPrompt").value ) || "";
        var strength  = parseFloat( ($("aiStrength") && $("aiStrength").value) || "0.35" ) || 0.35;

        updateStatus("Checking AI endpoint…");
        var ping = await pingEndpoints(3500);
        if (!ping) updateStatus("Could not reach AI endpoint (ping failed). Trying anyway…");
        else       updateStatus("Endpoint OK (" + ping.status + ") — preparing guide…");

        if (!(await ensureStopSelectedOrAutoOpen())) throw new Error("Select a scenario + photo/slide first.");

        var built = await withTimeout(buildGuideAndDataUrl(), 12000, "buildguide/timeout");
        var guideURL = built && built.guideURL;
        var dataUrl  = built && built.dataUrl;
        if (!guideURL && !dataUrl) throw new Error("Could not prepare guide image.");

        updateStatus( dataUrl ? "Guide ready ✓ (dataUrl) — contacting AI…" : "Guide ready ✓ (URL) — contacting AI…" );

        var scn = getScenarios();
        var hasOv = false; try { hasOv = !!(scn && scn.hasOverlays && scn.hasOverlays()); } catch(e){}

        var payload = {
          // img2img-like keys (many servers expect these)
          dataUrl: dataUrl || null,
          prompt: prompt,
          strength: strength,

          // compatibility keys (servers often check one of these)
          image: guideURL,
          returnType: kind, style: style, notes: prompt, hasOverlays: hasOv,
          guideURL: guideURL,
          "return": kind, mode: (kind==="overlays"?"overlays":"photo"),
          overlaysOnly: (kind==="overlays"), transparent: (kind==="overlays"),
          style_preset: style, input: guideURL, guideUrl: guideURL, imageURL: guideURL, image_url: guideURL, reference: guideURL, src: guideURL
        };

        window.__AI_LAST_PAYLOAD__ = payload; // debug

        var res = await postAI(payload, ping && ping.url);
        var norm = await normalizeAIResponse((res && res.json) || {}, res && res.endpoint);
        if (!norm){
          var keys = Object.keys((res && res.json) || {}).join(", ") || "(no keys)";
          throw new Error("AI did not return a usable image. Received keys: " + keys);
        }

        var finalURL = null;
        if (norm.finalURL){
          finalURL = norm.finalURL;
        } else if (norm.dataURL){
          // Use data URL directly (legacy path avoids Firebase upload)
          finalURL = norm.dataURL;
        }

        if (!finalURL) throw new Error("Could not resolve final image URL.");

        if (btnOpen){ btnOpen.disabled=false; btnOpen.onclick=function(){ try{ window.open(finalURL,"_blank"); }catch(e){} }; }
        if (btnAdd){
          btnAdd.disabled=false;
          btnAdd.onclick = async function(){
            try{
              if (scn && scn.addResultAsNewStop) { await scn.addResultAsNewStop(finalURL); updateStatus("Result added as a new stop ✓"); }
              else { window.open(finalURL, "_blank"); updateStatus("Opened result (no addResultAsNewStop method)."); }
            }catch(e){ updateStatus("Add failed: " + (e && (e.message||e))); }
          };
        }

        updateStatus("AI result ready ✓");
      }catch(e){
        warn("send failed", e);
        updateStatus("Send failed: " + (e && (e.message || e)));
      }finally{
        if (btnSend) btnSend.disabled = false;
      }
    });

    btnSend.dataset && (btnSend.dataset.wired = "1");
    updateStatus("AI ready");
  }

  // expose globally for legacy HTML to call after load
  window.wireAI = wireAI;

  // auto-init if DOM already loaded
  if (document.readyState === "complete" || document.readyState === "interactive"){
    try{ wireAI(); }catch(e){ warn("bind error", e); }
  }else{
    document.addEventListener("DOMContentLoaded", function(){ try{ wireAI(); }catch(e){ warn("bind error", e); } }, { once:true });
  }
})();
