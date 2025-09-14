// functions/ai-image.js — Netlify Function (CommonJS)
// Returns HTTP 200 JSON always.
// POST: accepts { image | dataUrl | guideURL | input | src, prompt, strength }
// If REPLICATE_API_TOKEN + REPLICATE_MODEL_VERSION exist → calls Replicate and returns first output URL.
// Else → echoes the input image URL so the client shows a result.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400"
};

function reply200(obj) {
  return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- Replicate config (set in Netlify env) ---
const REPLICATE_TOKEN  = process.env.REPLICATE_API_TOKEN || "";
const MODEL_VERSION    = process.env.REPLICATE_MODEL_VERSION || ""; // e.g. "...:abcdef1234"
const REPLICATE_URL    = "https://api.replicate.com/v1/predictions";

// Collect first truthy string from list
function pickString(...vals) { return vals.find(v => typeof v === "string" && v.trim().length > 0) || null; }

exports.handler = async (event) => {
  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };

    // GET health
    if (event.httpMethod === "GET") {
      try {
        const url = new URL(event.rawUrl || `http://x${event.path}`);
        if (url.searchParams.get("ping")) return reply200({ ok: true, pong: true, method: "GET", t: Date.now() });
      } catch {}
      return reply200({ ok: false, error: "Use POST for AI; GET ?ping=1 for healthcheck" });
    }

    // Parse body (tolerant)
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const pingHeader = event.headers && (event.headers["x-ai-ping"] || event.headers["X-AI-Ping"]);
    if (pingHeader || body.ping === true) return reply200({ ok: true, pong: true, method: "POST", t: Date.now() });

    // Gather possible image inputs
    const chosen = pickString(
      body.image, body.guideURL, body.guideUrl, body.input, body.src, body.url,
      body.image_url, body.imageURL, body.result, body.output, body.link, body.href,
      body.dataUrl, body.dataURL
    );

    const prompt   = typeof body.prompt === "string" ? body.prompt : (body.notes || "");
    let strength   = Number.isFinite(body.strength) ? body.strength : 0.35;
    if (strength < 0) strength = 0; if (strength > 1) strength = 1;

    // If nothing provided, return helpful JSON (still 200)
    if (!chosen) {
      return reply200({ ok: false, error: "No image provided (expected image/guideURL/input/src/url/dataUrl)" });
    }

    // If Replicate is NOT configured, just echo the input so client sees a result.
    if (!REPLICATE_TOKEN || !MODEL_VERSION) {
      return reply200({
        ok: true,
        image: { url: chosen },  // your test page supports image.url
        provider: "echo",
        reason: "Replicate not configured"
      });
    }

    // If input is a data URL, Replicate usually prefers an http(s) URL.
    // Your test URL is already http(s), so we pass it through directly.
    const sourceUrl = chosen;

    // Build Replicate payload (generic img2img keys; adjust if your model differs)
    const payload = {
      version: MODEL_VERSION,
      input: {
        prompt: String(prompt || ""),
        image: sourceUrl,
        strength
      }
    };

    // Create prediction
    const createRes = await fetch(REPLICATE_URL, {
      method: "POST",
      headers: { "Authorization": `Token ${REPLICATE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const createText = await createRes.text();
    let created = {};
    try { created = JSON.parse(createText); } catch {}
    if (!createRes.ok || !created.id) {
      return reply200({
        ok: false,
        error: "Replicate create failed",
        status: createRes.status,
        details: created || createText
      });
    }

    // Poll until done (≤ ~2 min)
    const id = created.id;
    let final = created;
    for (let i = 0; i < 120; i++) {
      const r = await fetch(`${REPLICATE_URL}/${id}`, {
        method: "GET",
        headers: { "Authorization": `Token ${REPLICATE_TOKEN}` }
      });
      const txt = await r.text();
      try { final = JSON.parse(txt); } catch { final = { status: "unknown" }; }
      if (final.status === "succeeded" || final.status === "failed" || final.status === "canceled") break;
      await sleep(1000);
    }

    // Extract first image URL from output
    let outUrl = null;
    const out = final && final.output;
    if (typeof out === "string" && /^https?:\/\//i.test(out)) outUrl = out;
    else if (Array.isArray(out)) {
      const first = out.find(x => typeof x === "string" && /^https?:\/\//i.test(x));
      if (first) outUrl = first;
    }

    if (final.status !== "succeeded" || !outUrl) {
      return reply200({
        ok: false,
        error: "Replicate did not return an image URL",
        status: final.status,
        id,
        output: final && final.output
      });
    }

    return reply200({
      ok: true,
      image: { url: outUrl },   // ← your test page accepts image.url
      provider: "replicate",
      id
    });

  } catch (e) {
    // Still 200 so client doesn't hard-fail
    return reply200({ ok: false, error: e?.message || String(e) });
  }
};
