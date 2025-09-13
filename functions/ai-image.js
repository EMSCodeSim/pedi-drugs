// functions/ai-image.js  — CommonJS / Netlify Functions
// Robust echo endpoint for your client. Always returns 200 JSON.
// Accepts many synonyms; falls back to a 1x1 PNG data URL so UI completes.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400"
};
function reply200(obj) {
  return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

const ONE_BY_ONE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

exports.handler = async (event) => {
  try {
    console.log("[ai-image] method:", event.httpMethod, "path:", event.path);

    // CORS preflight
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };

    // GET healthcheck: /.netlify/functions/ai-image?ping=1
    if (event.httpMethod === "GET") {
      try {
        const url = new URL(event.rawUrl || `http://x${event.path}`);
        if (url.searchParams.get("ping")) {
          return reply200({ ok: true, pong: true, method: "GET", t: Date.now() });
        }
      } catch {}
      return reply200({ ok: false, error: "Use POST for AI; GET ?ping=1 for healthcheck" });
    }

    // Only POST beyond this point
    if (event.httpMethod !== "POST") {
      return reply200({ ok: false, error: "Method not allowed (POST expected)" });
    }

    // Parse JSON (tolerant)
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (e) {
      console.warn("[ai-image] JSON parse failed:", e?.message);
      body = {};
    }

    // POST ping (header or body)
    const pingHeader = event.headers && (event.headers["x-ai-ping"] || event.headers["X-AI-Ping"]);
    if (pingHeader || body.ping === true) {
      return reply200({ ok: true, pong: true, method: "POST", t: Date.now() });
    }

    // Accept many synonyms from various clients
    const candidates = [
      body.dataUrl, body.dataURL,
      body.image, body.image_url, body.imageURL,
      body.guideURL, body.guideUrl,
      body.input, body.src, body.reference,
      body.url, body.output, body.result, body.link, body.href
    ].filter(v => typeof v === "string" && v.length > 0);

    const chosen = candidates[0] || ONE_BY_ONE_PNG;

    console.log("[ai-image] chosen source:", (chosen || "").slice(0, 80));

    // Echo back something usable by the browser
    return reply200({
      ok: true,
      image: chosen,                  // <- client normalizer will accept this
      mode: body.mode || "photo",
      receivedKeys: Object.keys(body || {}),
      notes: { hasDataUrl: !!body.dataUrl || !!body.dataURL }
    });
  } catch (e) {
    console.error("[ai-image] unexpected error:", e?.message || e);
    // Still return 200 so the UI doesn't mark it as endpoint failure
    return reply200({ ok: false, error: e?.message || String(e) });
  }
};
