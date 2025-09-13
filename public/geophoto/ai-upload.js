// netlify/functions/ai-image.js
// Minimal echo function that unblocks the client-side "AI: streaming…" state.
// - Handles CORS + OPTIONS preflight
// - Accepts { dataUrl, image, guideURL, prompt, strength }
// - Returns JSON: { ok: true, image: <string>, ... }
// Replace the "echo" return with your real AI pipeline and set `image` to the result URL/dataURL.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400"
};

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
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
    return json(405, { ok: false, error: "Method not allowed" });
  }

  // Quick ping (client uses this to verify reachability)
  const isPingHeader = (event.headers && (event.headers["x-ai-ping"] || event.headers["X-AI-Ping"]));
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }
  if (isPingHeader || body.ping === true) {
    return json(200, { ok: true, pong: true, t: Date.now() });
  }

  try {
    const { dataUrl, image, guideURL, prompt, strength } = body;

    // Choose the best available input to echo back
    const chosen =
      (typeof dataUrl === "string" && dataUrl.startsWith("data:image/") && dataUrl) ||
      (typeof image === "string" && image) ||
      (typeof guideURL === "string" && guideURL) ||
      null;

    if (!chosen) {
      return json(400, { ok: false, error: "No image provided (expected dataUrl, image, or guideURL)" });
    }

    // ✅ Echo back something the client can immediately display.
    // TODO: Replace this with your real AI call and set `image` to the resulting URL or dataURL.
    return json(200, {
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
    return json(500, { ok: false, error: e && (e.message || String(e)) });
  }
};
