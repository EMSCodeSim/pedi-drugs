/* scenarios-ui.legacy.js — Scenario Loader/Editor + canvas viewer
   - Defines window.__SCENARIOS with the methods your AI client expects:
     getCurrent(), getStopIndex(), loadStop(i),
     getGuideImageURLForCurrentStop(), getLastLoadedBaseURL(),
     getCompositeDataURL(w, q), isCanvasTainted(), hasOverlays(),
     addResultAsNewStop(url), setAIStatus(txt)
   - Provides UI to: New/Load JSON/Load images/Add URL/Save/Prev/Next/Delete/Rename
*/

(function(){
  "use strict";

  // --- DOM refs
  function $(id){ return document.getElementById(id); }
  var els = {
    select: $("scenarioSelect"),
    newBtn: $("scenarioNew"),
    loadImgs: $("scenarioLoadImgs"),
    loadJson: $("scenarioLoadJson"),
    addUrl: $("scenarioAddUrl"),
    save: $("scenarioSave"),
    prev: $("scenarioPrev"),
    next: $("scenarioNext"),
    del: $("stopDelete"),
    rename: $("stopRename"),
    name: $("scenarioName"),
    thumbs: $("thumbs"),
    fileImages: $("fileImages"),
    fileJson: $("fileJson"),
    canvas: $("mainCanvas"),
    aiMsg: $("aiMsg")
  };
  var ctx = els.canvas.getContext("2d");

  // --- state
  var state = {
    scenarios: [],           // [{id, name, _stops:[{id, url, title?, w?, h?}], _index}]
    current: null,
    lastBaseURL: null,
    lastTainted: false
  };

  // --- helpers
  function uid(p){ return (p||"id_") + Math.random().toString(36).slice(2, 9); }
  function setStatus(t){ if (els.aiMsg) els.aiMsg.textContent = t; }
  function fitContain(w, h, maxW, maxH){
    var r = Math.min(maxW / w, maxH / h); return { w: Math.round(w*r), h: Math.round(h*r) };
  }

  async function readFileAsDataURL(file){
    return new Promise(function(res, rej){
      var fr = new FileReader();
      fr.onload = ()=> res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  }

  function downloadJSON(obj, filename){
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename || "scenario.json";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // --- scenario core
  function createScenario(name){
    return { id: uid("scn_"), name: name || "Untitled", _stops: [], _index: -1 };
  }

  function refreshScenarioSelect(){
    var s = els.select;
    s.innerHTML = "";
    state.scenarios.forEach(function(sc){
      var opt = document.createElement("option");
      opt.value = sc.id; opt.textContent = sc.name + " (" + sc._stops.length + ")";
      s.appendChild(opt);
    });
    if (state.current){
      s.value = state.current.id;
      els.name.value = state.current.name || "";
    }
  }

  function refreshThumbs(){
    var wrap = els.thumbs;
    wrap.innerHTML = "";
    if (!state.current) return;
    state.current._stops.forEach(function(st, i){
      var d = document.createElement("div");
      d.className = "thumb" + (i===state.current._index ? " active":"");
      var img = document.createElement("img");
      img.loading = "lazy";
      img.src = st.url;
      var cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = (st.title || ("Slide " + (i+1)));
      d.appendChild(img); d.appendChild(cap);
      d.onclick = function(){ api.loadStop(i); };
      wrap.appendChild(d);
    });
  }

  async function drawToCanvas(url){
    return new Promise(function(res, rej){
      var img = new Image();
      // try CORS-friendly first
      img.crossOrigin = "anonymous";
      img.onload = function(){
        var W = els.canvas.width, H = els.canvas.height;
        // clear
        ctx.fillStyle = "#0a0d13"; ctx.fillRect(0,0,W,H);
        // contain fit
        var s = fitContain(img.naturalWidth, img.naturalHeight, W-2, H-2);
        var x = (W - s.w)/2, y = (H - s.h)/2;
        ctx.drawImage(img, x, y, s.w, s.h);

        // detect taint
        var tainted = false;
        try { els.canvas.toDataURL("image/jpeg", 0.1); } catch(e){ tainted = true; }
        state.lastTainted = tainted;
        res({ w: img.naturalWidth, h: img.naturalHeight, tainted: tainted });
      };
      img.onerror = function(){ rej(new Error("Image load failed: " + url)); };
      img.src = url;
    });
  }

  // --- API expected by the AI client
  var api = {
    // Selection
    getCurrent: function(){ return state.current; },
    getStopIndex: function(){ return state.current ? state.current._index : -1; },
    async loadStop(i){
      if (!state.current) throw new Error("No scenario");
      if (i<0 || i>=state.current._stops.length) throw new Error("Stop OOB");
      state.current._index = i;
      var st = state.current._stops[i];
      setStatus("Loading slide " + (i+1) + "…");
      state.lastBaseURL = st.url;
      try{
        await drawToCanvas(st.url);
        refreshThumbs();
        setStatus("Loaded slide " + (i+1));
      }catch(e){
        setStatus(e.message || String(e));
      }
    },
    // Guide info
    async getGuideImageURLForCurrentStop(){
      if (!state.current || state.current._index<0) throw new Error("No stop selected");
      return state.current._stops[state.current._index].url;
    },
    getLastLoadedBaseURL(){ return state.lastBaseURL; },

    // Composite (use the visible canvas)
    async getCompositeDataURL(width, quality){
      width = Math.max(8, Math.min(4096, width || els.canvas.width));
      var scale = width / els.canvas.width;
      var off = document.createElement("canvas");
      off.width = width;
      off.height = Math.round(els.canvas.height * scale);
      var octx = off.getContext("2d");
      octx.drawImage(els.canvas, 0, 0, off.width, off.height);
      var q = (typeof quality === "number" ? quality : 0.92);
      try {
        return off.toDataURL("image/jpeg", q);
      } catch(e) {
        // if tainted, signal by throwing
        var err = new Error("tainted");
        err.code = "tainted";
        throw err;
      }
    },

    isCanvasTainted(){ return !!state.lastTainted; },
    hasOverlays(){ return false; }, // no overlay editor in this minimal build

    async addResultAsNewStop(url){
      if (!state.current) return;
      state.current._stops.push({ id: uid("stop_"), url:url, title:"AI Result" });
      refreshThumbs();
      return api.loadStop(state.current._stops.length - 1);
    },

    setAIStatus(txt){ setStatus(txt); }
  };

  // expose earlier so other scripts can call it
  window.__SCENARIOS = api;

  // --- UI actions
  function bindUI(){

    // New scenario
    els.newBtn.addEventListener("click", function(){
      var name = prompt("Scenario name:", "Untitled");
      if (name === null) return;
      var sc = createScenario(name);
      state.scenarios.push(sc);
      state.current = sc;
      refreshScenarioSelect(); refreshThumbs();
      setStatus("New scenario created.");
    });

    // Select scenario
    els.select.addEventListener("change", function(){
      var id = els.select.value;
      var sc = state.scenarios.find(s=>s.id===id);
      if (sc){ state.current = sc; els.name.value = sc.name || ""; refreshScenarioSelect(); refreshThumbs(); setStatus("Scenario selected."); }
    });

    // Rename scenario
    els.name.addEventListener("change", function(){
      if (!state.current) return;
      state.current.name = els.name.value.trim() || "Untitled";
      refreshScenarioSelect();
    });

    // Load images (local files)
    els.loadImgs.addEventListener("click", function(){ els.fileImages.click(); });
    els.fileImages.addEventListener("change", async function(ev){
      if (!ev.target.files || !ev.target.files.length) return;
      if (!state.current){
        state.current = createScenario("Imported images");
        state.scenarios.push(state.current);
      }
      setStatus("Importing images…");
      for (var i=0;i<ev.target.files.length;i++){
        var f = ev.target.files[i];
        if (!f.type || f.type.indexOf("image") !== 0) continue;
        var dataURL = await readFileAsDataURL(f); // dataURL avoids CORS taint
        state.current._stops.push({ id: uid("stop_"), url:dataURL, title: f.name });
      }
      refreshScenarioSelect(); refreshThumbs();
      if (state.current._index < 0 && state.current._stops.length) api.loadStop(0);
      setStatus("Images imported.");
      ev.target.value = "";
    });

    // Load JSON (previously saved scenario)
    els.loadJson.addEventListener("click", function(){ els.fileJson.click(); });
    els.fileJson.addEventListener("change", async function(ev){
      if (!ev.target.files || !ev.target.files.length) return;
      var file = ev.target.files[0];
      try{
        var text = await file.text();
        var json = JSON.parse(text);
        // Expect { name, stops:[{url,title}] } or {_stops}
        var sc = createScenario(json.name || file.name.replace(/\.[^.]+$/,""));
        var stops = json.stops || json._stops || [];
        stops.forEach(function(s, i){
          if (s && s.url){ sc._stops.push({ id: uid("stop_"), url: s.url, title: s.title || ("Slide "+(i+1)) }); }
        });
        state.scenarios.push(sc);
        state.current = sc;
        refreshScenarioSelect(); refreshThumbs();
        if (sc._stops.length) api.loadStop(0);
        setStatus("Scenario loaded from JSON.");
      }catch(e){
        alert("Invalid JSON: " + (e.message||e));
      }finally{
        ev.target.value = "";
      }
    });

    // Add image by URL
    els.addUrl.addEventListener("click", async function(){
      if (!state.current){
        state.current = createScenario("Manual");
        state.scenarios.push(state.current);
      }
      var url = prompt("Image URL (https:// or data:image/...):", "");
      if (!url) return;
      state.current._stops.push({ id: uid("stop_"), url:url, title:"URL image" });
      refreshScenarioSelect(); refreshThumbs();
      if (state.current._index < 0) api.loadStop(0); else setStatus("Added URL image.");
    });

    // Save scenario to JSON (download)
    els.save.addEventListener("click", async function(){
      if (!state.current) return alert("No scenario.");
      var sc = state.current;
      // Persistable structure
      var out = { name: sc.name || "Untitled", stops: sc._stops.map(function(s){ return { url: s.url, title: s.title||"" }; }) };
      downloadJSON(out, (sc.name||"scenario").replace(/[^\w\-]+/g,"_") + ".json");
      setStatus("Scenario saved.");
    });

    // Prev/Next
    els.prev.addEventListener("click", function(){
      if (!state.current) return;
      var i = Math.max(0, (state.current._index|0) - 1);
      api.loadStop(i);
    });
    els.next.addEventListener("click", function(){
      if (!state.current) return;
      var i = Math.min(state.current._stops.length-1, (state.current._index|0) + 1);
      api.loadStop(i);
    });

    // Delete stop
    els.del.addEventListener("click", function(){
      if (!state.current || state.current._index<0) return;
      var i = state.current._index;
      if (!confirm("Delete slide " + (i+1) + "?")) return;
      state.current._stops.splice(i, 1);
      if (state.current._index >= state.current._stops.length) state.current._index = state.current._stops.length - 1;
      refreshThumbs();
      if (state.current._index >= 0) api.loadStop(state.current._index);
      else { ctx.clearRect(0,0,els.canvas.width,els.canvas.height); state.lastBaseURL=null; setStatus("No slides."); }
      refreshScenarioSelect();
    });

    // Rename stop
    els.rename.addEventListener("click", function(){
      if (!state.current || state.current._index<0) return;
      var st = state.current._stops[state.current._index];
      var name = prompt("Slide title:", st.title || "");
      if (name === null) return;
      st.title = name;
      refreshThumbs();
    });
  }

  // Public entry
  function wireScenarioUI(){
    bindUI();
    // Create one empty scenario to start with
    var sc = createScenario("Untitled");
    state.scenarios.push(sc);
    state.current = sc;
    refreshScenarioSelect(); refreshThumbs();
    setStatus("Scenario UI ready.");
  }

  // expose
  window.wireScenarioUI = wireScenarioUI;

  // auto-init
  if (document.readyState === "complete" || document.readyState === "interactive"){
    try{ wireScenarioUI(); }catch(e){ console.warn("[scenarios] init error", e); }
  }else{
    document.addEventListener("DOMContentLoaded", function(){ try{ wireScenarioUI(); }catch(e){ console.warn("[scenarios] init error", e); } }, { once:true });
  }
})();
