// functions/ai-image.js  (CommonJS / Netlify Functions)
// Robust: handles CORS, OPTIONS preflight, GET ping, POST (echo image or dataUrl)
// Returns ONE final JSON with an `image` so your UI can finish.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400"
};

function reply(statusCode, obj) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  // Lightweight GET ping in the browser:
  // https://YOURDOMAIN/.netlify/functions/ai-image?ping=1
  if (event.httpMethod === "GET") {
    const url = new URL(event.rawUrl || `http://x${event.path}`);
    if (url.searchParams.get("ping")) {
      return reply(200, { ok: true, pong: true, method: "GET", t: Date.now() });
    }
    // For plain GET without ping, show method not allowed so it’s clear it exists.
    return reply(405, { ok: false, error: "Use POST for AI; GET ?ping=1 for healthcheck" });
  }

  if (event.httpMethod !== "POST") {
    return reply(405, { ok: false, error: "Method not allowed" });
  }

  // Parse body (tolerant)
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}
  const pingHeader = event.headers && (event.headers["x-ai-ping"] || event.headers["X-AI-Ping"]);
  if (pingHeader || body.ping === true) {
    return reply(200, { ok: true, pong: true, method: "POST", t: Date.now() });
  }

  try {
    const { dataUrl, image, guideURL, prompt, strength } = body || {};
    const chosen =
      (typeof dataUrl === "string" && dataUrl.startsWith("data:image/") && dataUrl) ||
      (typeof image === "string" && image) ||
      (typeof guideURL === "string" && guideURL) ||
      null;

    if (!chosen) {
      return reply(400, { ok: false, error: "No image provided (expected dataUrl, image, or guideURL)" });
    }

    // ✅ Echo a usable image now. Replace with your real AI pipeline later.
    return reply(200, {
      ok: true,
      image: chosen,
      mode: "photo",
      echo: {
        hasDataUrl: !!dataUrl,
        hasGuideURL: !!guideURL,
        hasImage: !!image,
        prompt: prompt || "",
        strength: typeof strength === "number" ? strength : null
      }
    });
  } catch (e) {
    return reply(500, { ok: false, error: e && (e.message || String(e)) });
  }
};
