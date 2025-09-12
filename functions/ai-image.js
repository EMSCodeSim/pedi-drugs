// netlify/functions/ai-image.js
// Returns either a data URL (echo mode) or a direct URL from Replicate.
// No server-side bucket uploads — the client will upload to Firebase.

export default async (req, res) => {
  // --- CORS ---
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok:false, error:"Use POST" });
    }

    const bodyText = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    let payload;
    try { payload = typeof req.body === "object" ? req.body : JSON.parse(bodyText); }
    catch {
      return res.status(400).json({ ok:false, error:"Invalid JSON body" });
    }

    const { dataUrl, guideUrl, prompt = "", strength = 0.35 } = payload || {};
    if (!dataUrl && !guideUrl) {
      return res.status(400).json({ ok:false, error:"Provide either guideUrl (public URL) or dataUrl (base64 canvas output)." });
    }

    // Quick echo mode lets you validate the entire client pipeline without any 3rd-party calls.
    const AI_MODE = process.env.AI_MODE || (process.env.REPLICATE_API_TOKEN ? "replicate" : "echo");

    // Utility: fetch a URL as a data URL (if you sent guideUrl but want to echo)
    async function urlToDataURL(url) {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`Guide fetch failed: HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      const mime = r.headers.get("content-type") || "image/png";
      const b64 = Buffer.from(buf).toString("base64");
      return `data:${mime};base64,${b64}`;
    }

    if (AI_MODE === "echo") {
      // No AI call, just return something the client can upload to Firebase — perfect to kill bucket errors.
      const outDataUrl = dataUrl || await urlToDataURL(guideUrl);
      return res.status(200).json({ ok:true, image: outDataUrl, mode:"echo" });
    }

    // --- Replicate path (no server-side S3 writes) ---
    // Model: black-forest-labs/flux-1-schnell (fast image-to-image)
    // We try to send an image (either your composed dataUrl or guideUrl) + prompt.
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({ ok:false, error:"Replicate not configured (missing REPLICATE_API_TOKEN). Set AI_MODE=echo to test." });
    }

    const modelOwner = process.env.REPLICATE_MODEL_OWNER || "black-forest-labs";
    const modelName  = process.env.REPLICATE_MODEL_NAME  || "flux-1-schnell";

    // Prepare image input for Replicate: some models accept data URLs; most accept standard URLs.
    // Prefer uploading your composed canvas so overlays are baked in when present.
    let imageInputUrl = guideUrl || null;

    // If dataUrl exists, convert it to a small temporary data URL upload to Replicate's "image" field directly.
    // Replicate generally accepts data URLs for many models; if your chosen model doesn't,
    // you can host it elsewhere and pass the absolute URL instead.
    const inputImage = dataUrl ? dataUrl : imageInputUrl;

    // Fire the prediction
    const createURL = `https://api.replicate.com/v1/models/${encodeURIComponent(modelOwner)}/${encodeURIComponent(modelName)}/predictions`;
    const createResp = await fetch(createURL, {
      method: "POST",
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: {
          // Common inputs for fast I2I models:
          // - prompt: the prompt text
          // - image: data URL or public URL
          // - strength / guidance may vary by model; we provide a sane default
          prompt: prompt || "photo-realistic fire/scene composite",
          image: inputImage,
          strength
        }
      })
    });

    if (!createResp.ok) {
      const t = await createResp.text().catch(()=> "");
      return res.status(createResp.status).json({ ok:false, error:`Replicate create failed: ${t || createResp.statusText}` });
    }

    const created = await createResp.json();
    const pollURL = created?.urls?.get || created?.href;
    if (!pollURL) {
      return res.status(502).json({ ok:false, error:"Replicate did not return a poll URL." });
    }

    // Poll until done
    const started = Date.now();
    let outputUrl = null;
    while (Date.now() - started < 90000) { // up to 90s
      await new Promise(r => setTimeout(r, 1200));
      const pollResp = await fetch(pollURL, {
        headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
      });
      if (!pollResp.ok) {
        const t = await pollResp.text().catch(()=> "");
        return res.status(pollResp.status).json({ ok:false, error:`Replicate poll failed: ${t || pollResp.statusText}` });
      }
      const j = await pollResp.json();
      if (j.status === "succeeded") {
        // Replicate output is commonly an array of URLs; use the last item if array, else string
        const out = j.output;
        if (Array.isArray(out)) {
          outputUrl = out[out.length - 1];
        } else if (typeof out === "string") {
          outputUrl = out;
        } else if (out && out.image) {
          outputUrl = out.image;
        }
        break;
      } else if (j.status === "failed" || j.status === "canceled") {
        return res.status(502).json({ ok:false, error:`Replicate job ${j.status}. ${j.error || ""}`.trim() });
      }
      // else status: "starting" | "processing" -> keep polling
    }

    if (!outputUrl) {
      return res.status(504).json({ ok:false, error:"Timed out waiting for Replicate output." });
    }

    // Return a direct URL — client will fetch & upload to Firebase. No S3 on our side.
    return res.status(200).json({ ok:true, image: { url: outputUrl }, mode:"replicate" });

  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    return res.status(500).json({ ok:false, error: msg });
  }
};
