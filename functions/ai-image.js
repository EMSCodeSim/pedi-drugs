// functions/ai-image.js — Netlify Function (CommonJS) with diagnostics
// - Always returns 200 JSON so the browser never says "All endpoints failed".
// - POST accepts { image | dataUrl | guideURL | input | src, prompt, strength, modelVersion? }.
// - If REPLICATE_API_TOKEN + REPLICATE_MODEL_VERSION (or body.modelVersion) exist → calls Replicate.
// - Else → echoes the input image URL so you still see a result, with provider:"echo".
// - Adds diagnostics so you can see why Replicate wasn't called.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400",
};
const reply200 = (obj) => ({ statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- Replicate config (env) ----
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const MODEL_VERSION_ENV = process.env.REPLICATE_MODEL_VERSION || ""; // e.g. "owner/model:versionHash" or just version hash depending on your setup
const REPLICATE_URL = "https://api.replicate.com/v1/predictions";

// Pick the first non-empty string
const pickString = (...vals) => vals.find(v => typeof v === "string" && v.trim().length > 0) || null;

exports.handler = async (event) => {
  try {
    // OPTIONS (CORS)
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };

    // GET ?ping=1 healthcheck
    if (event.httpMethod === "GET") {
      try {
        const url = new URL(event.rawUrl || `http://x${event.path}`);
        if (url.searchParams.get("ping")) return reply200({ ok: true, pong: true, method: "GET", t: Date.now() });
      } catch {}
      return reply200({ ok: false, error: "Use POST for AI; GET ?ping=1 for healthcheck" });
    }

    // Parse body
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}

    // POST ping
    const pingHeader = event.headers && (event.headers["x-ai-ping"] || event.headers["X-AI-Ping"]);
    if (pingHeader || body.ping === true) return reply200({ ok: true, pong: true, method: "POST", t: Date.now() });

    // Collect candidate image sources
    const chosen = pickString(
      body.image, body.guideURL, body.guideUrl, body.input, body.src, body.url,
      body.image_url, body.imageURL, body.result, body.output, body.link, body.href,
      body.dataUrl, body.dataURL
    );

    const prompt = typeof body.prompt === "string" ? body.prompt : (body.notes || "");
    let strength = Number.isFinite(body.strength) ? body.strength : 0.35;
    if (strength < 0) strength = 0; if (strength > 1) strength = 1;

    const diagnostics = {
      hasToken: !!REPLICATE_TOKEN,
      hasModelEnv: !!MODEL_VERSION_ENV,
      modelVersionFromBody: typeof body.modelVersion === "string" ? body.modelVersion : null,
      usedModelVersion: null,
      receivedImageIsHttp: !!(chosen && /^https?:\/\//i.test(chosen)),
      receivedImageIsDataUrl: !!(chosen && String(chosen).startsWith("data:image/")),
      provider: null
    };

    if (!chosen) {
      return reply200({ ok: false, error: "No image provided (expected image/guideURL/input/src/url/dataUrl)", diagnostics });
    }

    // Determine model version (env or body override)
    const MODEL_VERSION = (diagnostics.modelVersionFromBody || MODEL_VERSION_ENV || "").trim();
    diagnostics.usedModelVersion = MODEL_VERSION || null;

    // If not configured, echo path (unchanged image) with explicit diagnostics
    if (!REPLICATE_TOKEN || !MODEL_VERSION) {
      diagnostics.provider = "echo";
      return reply200({
        ok: true,
        image: { url: chosen },       // test page supports image.url
        provider: "echo",
        reason: !REPLICATE_TOKEN ? "Missing REPLICATE_API_TOKEN" : "Missing REPLICATE_MODEL_VERSION",
        diagnostics
      });
    }

    // ---- Replicate call ----
    diagnostics.provider = "replicate";
    const payload = {
      version: MODEL_VERSION,          // NOTE: must be a VERSION ID/hash that matches the model
      input: {
        prompt: String(prompt || ""),
        image: chosen,                 // Prefer http(s). Some models also accept data URLs.
        strength
      }
    };

    console.log("[replicate] create prediction…", { hasToken: !!REPLICATE_TOKEN, version: MODEL_VERSION });
    const createRes = await fetch(REPLICATE_URL, {
      method: "POST",
      headers: { "Authorization": `Token ${REPLICATE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const createText = await createRes.text();
    let created = {};
    try { created = JSON.parse(createText); } catch {}
    console.log("[replicate] create status:", createRes.status, "id:", created && created.id);

    if (!createRes.ok || !created.id) {
      return reply200({ ok: false, error: "Replicate create failed", status: createRes.status, details: created || createText, diagnostics });
    }

    const id = created.id;
    let final = created;
    for (let i = 0; i < 120; i++) {        // ~2 min @1s
      const r = await fetch(`${REPLICATE_URL}/${id}`, {
        method: "GET",
        headers: { "Authorization": `Token ${REPLICATE_TOKEN}` }
      });
      const txt = await r.text();
      try { final = JSON.parse(txt); } catch { final = { status: "unknown" }; }
      if (i % 5 === 0) console.log("[replicate] poll", id, "status:", final.status);
      if (final.status === "succeeded" || final.status === "failed" || final.status === "canceled") break;
      await sleep(1000);
    }

    // Extract first URL from output
    let outUrl = null;
    const out = final && final.output;
    if (typeof out === "string" && /^https?:\/\//i.test(out)) outUrl = out;
    else if (Array.isArray(out)) {
      const first = out.find(x => typeof x === "string" && /^https?:\/\//i.test(x));
      if (first) outUrl = first;
    }

    if (final.status !== "succeeded" || !outUrl) {
      return reply200({ ok: false, error: "Replicate did not return an image URL", status: final.status, id, output: final && final.output, diagnostics });
    }

    return reply200({ ok: true, image: { url: outUrl }, provider: "replicate", id, diagnostics });
  } catch (e) {
    return reply200({ ok: false, error: e?.message || String(e), diagnostics: { provider: "exception" } });
  }
};
