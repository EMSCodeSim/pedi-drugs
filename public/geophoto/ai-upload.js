// functions/ai-image.js  (CommonJS / Netlify Functions)
// Minimal, reliable handler to unblock the client.
// - Handles CORS + OPTIONS preflight
// - Accepts { dataUrl, image, guideURL, prompt, strength, ping }
// - Returns ONE final JSON with an `image` the client can display

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400"
};

function json(bodyObj, statusCode = 200, extra = {}) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extra },
    body: JSON.stringify(bodyObj)
  };
}

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  // Only POST
  if (event.httpMethod !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // Ping path
  const pingHeader = event.headers && (event.headers["x-ai-ping"] || event.headers["X-AI-Ping"]);
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  if (pingHeader || body.ping === true) {
    return json({ ok: true, pong: true, t: Date.now() }, 200);
  }

  try {
    const { dataUrl, image, guideURL, prompt, strength } = body || {};
    const chosen =
      (typeof dataUrl === "string" && dataUrl.startsWith("data:image/") && dataUrl) ||
      (typeof image === "string" && image) ||
      (typeof guideURL === "string" && guideURL) ||
      null;

    if (!chosen) {
      return json({ ok: false, error: "No image provided (expected dataUrl, image, or guideURL)" }, 400);
    }

    // Echo a usable image now. Replace with your real AI pipeline later.
    return json({
      ok: true,
      image: chosen,
      mode: "photo",
      echo: {
        hasDataUrl: !!dataUrl,
        hasGuideURL: !!guideURL,
        hasImage: !!image,
        prompt: prompt || "",
        strength: (typeof strength === "number") ? strength : null
      }
    }, 200);
  } catch (e) {
    return json({ ok: false, error: e && (e.message || String(e)) }, 500);
  }
};
