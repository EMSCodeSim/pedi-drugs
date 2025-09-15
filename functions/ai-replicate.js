<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Replicate SDXL img2img — Reliable Test</title>
<style>
  :root { --bg:#0b1020; --panel:#111830; --soft:#1a2342; --text:#e9eefb; --muted:#a8b3d0; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--text); font:14px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  header { padding:14px 18px; background:var(--panel); border-bottom:1px solid #223059; font-weight:600; }
  main { padding:16px; display:grid; gap:16px; grid-template-columns: 380px 1fr; }
  .card { background:var(--panel); border:1px solid #223059; border-radius:12px; padding:14px; }
  h2 { margin:0 0 10px; font-size:16px; }
  label { display:block; margin:10px 0 6px; color:var(--muted); }
  input[type="text"], textarea, input[type="number"] {
    width:100%; box-sizing:border-box; border:1px solid #2a3868; background:var(--soft); color:var(--text);
    border-radius:8px; padding:8px 10px; outline:none;
  }
  textarea { min-height:92px; resize:vertical; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  button {
    appearance:none; border:1px solid #2a3868; background:#2a3868; color:#fff; padding:9px 12px; border-radius:10px;
    cursor:pointer; font-weight:600;
  }
  button.secondary { background:transparent; }
  button:disabled { opacity:.6; cursor:default; }
  .grid { display:grid; gap:12px; grid-template-columns: 1fr 1fr; }
  .preview { background:#0a0f21; border:1px dashed #2a3868; border-radius:12px; min-height:220px; display:grid; place-items:center; overflow:auto; }
  .preview img { max-width:100%; height:auto; display:block; }
  .mono { white-space:pre-wrap; background:#0a0f21; border:1px solid #223059; border-radius:10px; padding:10px; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color:#cfe3ff; }
  .pill { display:inline-block; padding:4px 8px; border-radius:999px; background:#19254a; border:1px solid #2a3868; color:#cfe3ff; font-size:12px; }
  .muted { color:var(--muted); }
  footer { padding:12px 16px; color:#94a3c5; }
  .small { font-size:12px; }
</style>
</head>
<body>
  <header>Replicate SDXL img2img — Reliable Test Harness</header>
  <main>
    <section class="card">
      <h2>1) Input</h2>

      <label>Upload image (best for testing — uses base64 data URL)</label>
      <input id="file" type="file" accept="image/*" />

      <div class="row" style="margin-top:8px;">
        <button id="btn-sample">Use built-in sample</button>
        <button id="btn-public" class="secondary">Use known public URL</button>
        <span id="hint" class="muted small">Pick one of the options above, or paste your own URL below.</span>
      </div>

      <label style="margin-top:10px;">Public image URL (optional)</label>
      <input id="url" type="text" placeholder="https://..." />

      <label style="margin-top:10px;">Firebase Storage path (optional, requires Admin env on function)</label>
      <input id="storagePath" type="text" placeholder="scenarios/-OZH6KD_krWW-FODi4A_/1756945542530.jpg" />

      <label style="margin-top:14px;">Prompt</label>
      <textarea id="prompt">make this look like a realistic emergency fire scene; blend overlays naturally; photorealistic</textarea>

      <label>Image strength (0–1, lower = stay close to original)</label>
      <input id="strength" type="number" step="0.01" min="0" max="1" value="0.55" />

      <div class="row" style="margin-top:12px;">
        <button id="run">Run Replicate</button>
        <span id="status" class="pill">idle</span>
      </div>

      <div class="small muted" style="margin-top:10px;">
        This calls <code>/.netlify/functions/ai-replicate</code>. It sends <span class="pill">dataUrl</span> if you uploaded/used the sample,
        otherwise <span class="pill">imageUrl</span> or <span class="pill">storagePath</span>.
      </div>
    </section>

    <section class="card">
      <h2>2) Result</h2>
      <div class="grid">
        <div>
          <div class="muted small" style="margin-bottom:6px;">Input preview</div>
          <div id="inPrev" class="preview"><span class="muted small">No image selected yet</span></div>
        </div>
        <div>
          <div class="muted small" style="margin-bottom:6px;">Output from Replicate</div>
          <div id="outPrev" class="preview"><span class="muted small">No output yet</span></div>
        </div>
      </div>

      <div style="margin-top:12px;">
        <div class="muted small" style="margin-bottom:6px;">Raw JSON</div>
        <div id="json" class="mono small">—</div>
      </div>
    </section>
  </main>
  <footer class="small">
    Tip: if output doesn’t show, expand the Raw JSON. The function returns a <code>trace</code> array that shows each poll step.
  </footer>

<script>
  const fnUrl = "/.netlify/functions/ai-replicate";
  const el = {
    file: document.getElementById("file"),
    url: document.getElementById("url"),
    storagePath: document.getElementById("storagePath"),
    prompt: document.getElementById("prompt"),
    strength: document.getElementById("strength"),
    run: document.getElementById("run"),
    sample: document.getElementById("btn-sample"),
    public: document.getElementById("btn-public"),
    status: document.getElementById("status"),
    inPrev: document.getElementById("inPrev"),
    outPrev: document.getElementById("outPrev"),
    json: document.getElementById("json"),
  };

  let chosenDataUrl = null;

  // Utilities
  const setStatus = (t) => el.status.textContent = t;
  const showJSON = (obj) => el.json.textContent = JSON.stringify(obj, null, 2);
  const setPreview = (node, src, link) => {
    node.innerHTML = "";
    if (src) {
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.alt = "preview";
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.src = src;
      img.onerror = () => { node.innerHTML = `<div class="muted small">Image tag could not display. <a href="${link||src}" target="_blank">Open in new tab</a></div>`; };
      node.appendChild(img);
    } else {
      node.innerHTML = `<span class="muted small">No image</span>`;
    }
  };

  // 1) Upload file → dataUrl (most reliable)
  el.file.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      chosenDataUrl = reader.result;
      setPreview(el.inPrev, chosenDataUrl);
      // Clear other fields to ensure we send dataUrl path
      el.url.value = "";
      el.storagePath.value = "";
    };
    reader.readAsDataURL(f);
  });

  // 2) Built-in sample → generate canvas → dataUrl
  el.sample.addEventListener("click", () => {
    const w=640, h=400;
    const c=document.createElement("canvas"); c.width=w; c.height=h;
    const ctx=c.getContext("2d");
    const g=ctx.createLinearGradient(0,0,w,h);
    g.addColorStop(0,"#666"); g.addColorStop(1,"#ddd");
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
    ctx.fillStyle="#000"; ctx.fillRect(0,h-80,w,80);
    ctx.fillStyle="#fff"; ctx.font="bold 28px system-ui, sans-serif";
    ctx.fillText("Built-in sample image", 16, h-40);
    ctx.fillStyle="#c00"; ctx.fillRect(20,40,120,70);
    ctx.fillStyle="#222"; ctx.fillRect(30,100,580,10);
    const d = c.toDataURL("image/png");
    chosenDataUrl = d;
    setPreview(el.inPrev, chosenDataUrl);
    el.url.value = "";
    el.storagePath.value = "";
  });

  // 3) Known-public URL (Wikipedia)
  el.public.addEventListener("click", () => {
    el.url.value = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/640px-Example.jpg";
    chosenDataUrl = null;
    setPreview(el.inPrev, el.url.value);
    el.storagePath.value = "";
  });

  // Typing a URL shows a live input preview (so you know it’s loadable by the browser)
  el.url.addEventListener("input", () => {
    chosenDataUrl = null;
    const u = el.url.value.trim();
    if (u) setPreview(el.inPrev, u);
  });

  // Main run
  el.run.addEventListener("click", async () => {
    try {
      el.run.disabled = true;
      setStatus("sending…");
      el.outPrev.innerHTML = `<span class="muted small">Waiting…</span>`;
      showJSON("—");

      const body = {
        prompt: el.prompt.value.trim(),
        imageStrength: Number(el.strength.value || 0.55)
      };

      if (chosenDataUrl) {
        body.dataUrl = chosenDataUrl;                // Most reliable path
      } else if (el.storagePath.value.trim()) {
        body.storagePath = el.storagePath.value.trim(); // Requires Firebase Admin on function
      } else if (el.url.value.trim()) {
        body.imageUrl = el.url.value.trim();         // Must be truly public
      } else {
        alert("Please upload a file, use the built-in sample, paste a public URL, or provide a storage path.");
        el.run.disabled = false;
        setStatus("idle");
        return;
      }

      const res = await fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control":"no-cache" },
        body: JSON.stringify(body)
      });

      const json = await res.json().catch(() => ({}));
      showJSON(json);

      if (json && json.ok && json.image_url) {
        setStatus("done");
        setPreview(el.outPrev, json.image_url, json.image_url);
      } else {
        setStatus("error");
        el.outPrev.innerHTML = `<div class="muted small">No output image. Check the Raw JSON below for details.</div>`;
      }
    } catch (err) {
      console.error(err);
      setStatus("error");
      el.outPrev.innerHTML = `<div class="muted small">Request failed. Open DevTools console for details.</div>`;
    } finally {
      el.run.disabled = false;
    }
  });
</script>
</body>
</html>
