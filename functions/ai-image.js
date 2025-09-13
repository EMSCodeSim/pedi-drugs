// functions/ai-image.js  (CommonJS / Netlify Functions)
// Robust: handles CORS, OPTIONS preflight, GET ping, POST echo
// Always returns ONE final JSON on POST so the UI won't say "All endpoints failed".

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
  // Helpful logs in Netlify console
  console.log("[ai-image] method:", event.httpMethod, "path:", event.path);

  // OPTIONS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  // Simple GET healthcheck: /.netlify/functions/ai-image?ping=1
  if (event.httpMethod === "GET") {
    try {
      const url = new URL(event.rawUrl || `http://x${event.path}`);
      if (url.searchParams.get("ping")) {
        return reply(200, { ok: true, pong: true, method: "GET", t: Date.now() });
      }
    } catch {}
    return reply(405, { ok: false, error: "Use POST for AI; GET ?ping=1 for healthcheck" });
  }

  // Only POST beyond this point
  if (event.httpMethod !== "POST") {
    return reply(405, { ok: false, error: "Method not allowed" });
  }

  // Parse JSON body (tolerant)
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {
    console.warn("[ai-image] JSON parse failed:", e.message);
  }

  // POST ping
  const pingHeader = event.headers && (event.headers["x-ai-ping"] || event.headers["X-AI-Ping"]);
  if (pingHeader || body.ping === true) {
    return reply(200, { ok: true, pong: true, method: "POST", t: Date.now() });
  }

  try {
    const { dataUrl, image, guideURL, prompt, strength } = body || {};

    // Choose something the client can display
    const chosen =
      (typeof dataUrl === "string" && dataUrl.startsWith("data:image/") && dataUrl) ||
      (typeof image === "string" && image) ||
      (typeof guideURL === "string" && guideURL) ||
      null;

    if (!chosen) {
      // 200 with error false-positive is a bad UX; use 400 so client knows it failed
      return reply(400, { ok: false, error: "No image provided (expected dataUrl, image, or guideURL)" });
    }

    // ✅ Echo back a usable image now. Replace with your real AI pipeline later.
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
    console.error("[ai-image] error:", e);
    return reply(500, { ok: false, error: e && (e.message || String(e)) });
  }
};
