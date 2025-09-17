<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Advanced Editor — Firebase Scenarios + AI</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { --bg:#0a0f14; --panel:#0f1720; --ink:#e6edf3; --muted:#9fb0c0; --pill:#1b2836; --accent:#2e7dd7; }
    html,body { height:100%; margin:0; background:var(--bg); color:var(--ink); font:14px/1.4 system-ui, sans-serif; }
    #app { display:grid; grid-template-columns: 280px 1fr 320px; grid-template-rows:auto 1fr auto; gap:10px; height:100%; padding:10px; }
    header, aside, main, section, footer { background:var(--panel); border-radius:12px; }
    header, footer { padding:8px 12px; display:flex; align-items:center; gap:8px; }
    header .pill, footer .pill { background:var(--pill); border-radius:999px; padding:4px 10px; color:var(--muted); }
    #left { padding:10px; display:flex; flex-direction:column; gap:10px; }
    #right { padding:10px; display:flex; flex-direction:column; gap:12px; }
    #center { display:grid; grid-template-rows: 1fr auto; }
    #stageWrap { position:relative; display:grid; place-items:center; padding:8px; }
    #stage { width:100%; height:100%; display:grid; place-items:center; }
    canvas { background:#061621; border-radius:10px; width:100%; height:100%; }
    #canvasInfo { color:var(--muted); padding:8px; text-align:center; }
    h3 { margin:0 0 8px 0; font-size:13px; color:var(--muted); letter-spacing:.3px; text-transform:uppercase; }
    label { display:block; margin:6px 0 3px; color:var(--muted); font-size:12px; }
    input[type="text"], input[type="number"], select, textarea {
      width:100%; box-sizing:border-box; border:1px solid #1e2a36; background:#0c121a; color:#dfe7ee;
      padding:8px; border-radius:8px; outline:none;
    }
    textarea { min-height:90px; resize:vertical; }
    button {
      background:#153055; color:#eaf2fb; border:none; border-radius:10px; padding:10px 12px; cursor:pointer;
    }
    button:disabled { opacity:.55; cursor:not-allowed; }
    .row { display:flex; gap:8px; align-items:center; }
    .stack { display:flex; flex-direction:column; gap:8px; }
    .pill.small { font-size:12px; padding:3px 8px; }
    #thumbRow { display:grid; grid-template-columns: repeat(auto-fill, 84px); gap:8px; overflow:auto; max-height:40vh; }
    #thumbRow img.thumb { width:84px; height:84px; object-fit:cover; border-radius:8px; opacity:.85; border:2px solid transparent; background:#000; }
    #thumbRow img.thumb.active { border-color: var(--accent); opacity:1; }
    #errbar { display:none; background:#3a1010; color:#ffd7d7; padding:8px 10px; border-radius:8px; margin:6px 0; }
    #loader { position:fixed; inset:0; display:none; place-items:center; background:rgba(0,0,0,.35); z-index:10; }
    #loader .box { background:#0f1720; padding:14px 18px; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.4); }
    /* collapsible tools (optional) */
    #app.toolsCollapsed #left, #app.toolsCollapsed #right { display:none; }
    #app.toolsCollapsed { grid-template-columns: 1fr; }
    .muted { color:var(--muted); }
  </style>
</head>
<body>
<div id="app" class="">
  <header>
    <button id="toggleTools" title="Hide/Show side panels">Hide Tools</button>
    <div class="pill" id="authPill">Auth: …</div>
    <div class="pill" id="statusPill">Idle</div>
    <div class="pill" id="rootPill">root: —</div>
  </header>

  <!-- Left: Scenario list & thumbs -->
  <aside id="left">
    <div id="errbar"></div>

    <div class="row">
      <h3 style="flex:1">Scenarios</h3>
      <button id="refreshBtn" title="Reload DB">Refresh</button>
    </div>
    <select id="scenarioSel"></select>

    <div class="stack">
      <h3>Photos / Slides</h3>
      <div id="thumbRow"></div>
    </div>

    <div class="stack">
      <h3>Stop Meta</h3>
      <label>Title</label>
      <input id="stopTitle" type="text" placeholder="e.g., Front approach" />
      <label>Caption</label>
      <input id="stopCaption" type="text" placeholder="optional" />
      <div class="row">
        <div style="flex:1">
          <label>Lat</label>
          <input id="stopLat" type="text" inputmode="decimal" />
        </div>
        <div style="flex:1">
          <label>Lng</label>
          <input id="stopLng" type="text" inputmode="decimal" />
        </div>
      </div>
      <label>Radius (m)</label>
      <input id="stopRadius" type="number" min="5" max="1000" step="5" value="50" />
      <div class="row">
        <button id="useGPS">Use GPS</button>
        <button id="saveMeta">Save Meta</button>
        <button id="deleteScenario" style="margin-left:auto;background:#4a1a1a">Delete Scenario</button>
      </div>
      <div id="metaMsg" class="muted"></div>
    </div>
  </aside>

  <!-- Center: Canvas -->
  <main id="center">
    <div id="stageWrap">
      <div id="stage">
        <canvas id="c" width="1580" height="900"></canvas>
      </div>
      <div id="loader"><div class="box">Loading…</div></div>
    </div>
    <div id="canvasInfo">Canvas ready.</div>
  </main>

  <!-- Right: AI controls -->
  <section id="right">
    <div class="stack">
      <h3>AI (img→img)</h3>
      <label for="aiReturn">Return</label>
      <select id="aiReturn">
        <option value="photo" selected>Photo (composited)</option>
        <option value="overlays">Overlays Only (transparent)</option>
      </select>

      <label for="aiStyle">Style</label>
      <select id="aiStyle">
        <option value="realistic" selected>Realistic</option>
        <option value="cinematic">Cinematic</option>
        <option value="dramatic">Dramatic</option>
        <option value="documentation">Documentation</option>
      </select>

      <label for="aiStrength">Strength (0.0–1.0)</label>
      <input id="aiStrength" type="number" step="0.05" min="0" max="1" value="0.35" />

      <label for="aiNotes">Notes / prompt (optional)</label>
      <textarea id="aiNotes" placeholder="Describe smoke, fire, people, vehicles, time of day, etc."></textarea>

      <div class="row">
        <button id="aiPreview" title="Show payload summary">Preview</button>
        <button id="aiSend">Send to AI</button>
        <button id="aiOpen" disabled>Open Result</button>
        <button id="aiAdd" disabled>Add as New Stop</button>
      </div>
      <div id="aiMsg" class="muted">AI idle.</div>
    </div>

    <div class="stack">
      <h3>Export</h3>
      <div class="row">
        <button id="exportPNG" disabled>Export PNG</button>
        <button id="saveImage" disabled>Save to Cloud</button>
      </div>
      <div class="muted">Export/save are auto-disabled if the base image is cross-origin tainted; AI still works by sending the guide URL. </div>
    </div>
  </section>

  <footer>
    <div class="pill small">Tip: Click a thumbnail to load the photo/slide.</div>
    <div class="pill small">If no scenarios appear, check your DB paths and auth rules.</div>
  </footer>
</div>

<!-- Fabric MUST load before scenarios.js (it constructs the canvas) -->
<script src="https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js"></script>

<!-- Your modules -->
<script type="module">
  import { initFirebase, getStorageInfo } from "./firebase-core.js";
  import SCN from "./scenarios.js";

  // Boot sequence: init Firebase → wire UI → boot scenarios (detect root, load, subscribe)
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      initFirebase(); // shared singletons
      SCN.wireScenarioUI();  // binds dropdown, GPS, save meta, export/save, tools, etc.  (exports provided)
      await SCN.bootScenarios(); // detect root, load list, subscribe to changes, set pills
      const info = getStorageInfo();
      console.log("Bucket:", info.bucketHost);
    } catch (e) {
      console.error(e);
      const err = document.getElementById("errbar");
      if (err) { err.style.display="block"; err.textContent = e && (e.message || String(e)); }
    }
  });

  // Optional: expose for quick debugging
  window.__SCN = SCN;
</script>

<!-- AI uploader (legacy, auto-wires to buttons with #ai* and uses window.__SCENARIOS) -->
<script src="./ai-upload.legacy.js"></script>
</body>
</html>
