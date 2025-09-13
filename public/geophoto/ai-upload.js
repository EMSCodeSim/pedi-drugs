<script type="module">
(async () => {
  const statusEl = document.getElementById("aiMsg");
  const say = (t) => { if (statusEl) statusEl.textContent = t; console.log(t); };

  // Try local file first (same-origin = no CORS headaches)
  const candidates = [
    new URL("./ai-upload.js", location.href).href,
    // optional fallback to your CDN (without cache-buster to avoid some static hosts returning 404 on querystrings)
    "https://fireopssim.com/geophoto/ai-upload.js"
  ];

  let loaded = false, lastErr = null;
  for (const url of candidates) {
    try {
      const mod = await import(url);
      if (typeof mod.wireAI === "function") mod.wireAI();
      loaded = true;
      say("AI client loaded ✓");
      break;
    } catch (e) {
      console.warn("AI module import failed:", url, e);
      lastErr = e;
    }
  }

  if (!loaded) {
    say("Failed to load AI client module.");
    console.error("Last error:", lastErr);
  }
})();
</script>
