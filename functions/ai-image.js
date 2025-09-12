// netlify/functions/ai-image.mjs
// Netlify Functions v2 (ESM): (request, context) => Response
// Returns either a data URL (echo mode) or a direct URL from Replicate.
// No server-side bucket uploads — the client uploads to Firebase.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default async (request, context) => {
  try {
    // --- CORS preflight ---
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Use POST" }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const { dataUrl, guideUrl, prompt = "", strength = 0.35 } = payload || {};
    if (!dataUrl && !guideUrl) {
      return json({ ok: false, error: "Provide either guideUrl (public URL) or dataUrl (base64 canvas output)." }, 400);
    }

    // If you have REPLICATE_API_TOKEN we call Replicate; otherwise echo back a data URL
    const AI_MODE = process.env.AI_MODE || (process.env.REPLICATE_API_TOKEN ? "replicate" : "echo");

    async function urlToDataURL(url) {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`Guide fetch failed: HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") || "image/png";
      return `data:${mime};base64,${buf.toString("base64")}`;
    }

    if (AI_MODE === "echo") {
      const outDataUrl = dataUrl || await urlToDataURL(guideUrl);
      return json({ ok: true, image: outDataUrl, mode: "echo" });
    }

    // --- Replicate path (no server-side S3 writes) ---
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    if (!REPLICATE_API_TOKEN) {
      return json({ ok: false, error: "Replicate not configured (missing REPLICATE_API_TOKEN). Set AI_MODE=echo to test." }, 500);
    }

    const modelOwner = process.env.REPLICATE_MODEL_OWNER || "black-forest-labs";
    const modelName  = process.env.REPLICATE_MODEL_NAME  || "flux-1-schnell";

    const inputImage = dataUrl ? dataUrl : guideUrl;

    const createURL = `https://api.replicate.com/v1/models/${encodeURIComponent(modelOwner)}/${encodeURIComponent(modelName)}/predictions`;
    const createResp = await fetch(createURL, {
      method: "POST",
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: {
          prompt: prompt || "photo-realistic fire/scene composite",
          image: inputImage,
          strength
        }
      })
    });

    if (!createResp.ok) {
      const t = await createResp.text().catch(() => "");
      return json({ ok: false, error: `Replicate create failed: ${t || createResp.statusText}` }, createResp.status);
    }

    const created = await createResp.json();
    const pollURL = created?.urls?.get || created?.href;
    if (!pollURL) {
      return json({ ok: false, error: "Replicate did not return a poll URL." }, 502);
    }

    // Poll for completion (up to ~90s)
    const started = Date.now();
    let outputUrl = null;
    while (Date.now() - started < 90000) {
      await sleep(1200);
      const pollResp = await fetch(pollURL, {
        headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
      });
      if (!pollResp.ok) {
        const t = await pollResp.text().catch(() => "");
        return json({ ok: false, error: `Replicate poll failed: ${t || pollResp.statusText}` }, pollResp.status);
      }
      const j = await pollResp.json();
      if (j.status === "succeeded") {
        const out = j.output;
        if (Array.isArray(out)) outputUrl = out[out.length - 1];
        else if (typeof out === "string") outputUrl = out;
        else if (out && out.image) outputUrl = out.image;
        break;
      } else if (j.status === "failed" || j.status === "canceled") {
        return json({ ok: false, error: `Replicate job ${j.status}. ${j.error || ""}`.trim() }, 502);
      }
      // else "starting"/"processing" -> continue polling
    }

    if (!outputUrl) {
      return json({ ok: false, error: "Timed out waiting for Replicate output." }, 504);
    }

    // Return a direct URL; your client uploads to Firebase Storage.
    return json({ ok: true, image: { url: outputUrl }, mode: "replicate" });

  } catch (err) {
    return json({ ok: false, error: (err?.message || String(err)) }, 500);
  }
};

/* ---------- helpers ---------- */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
