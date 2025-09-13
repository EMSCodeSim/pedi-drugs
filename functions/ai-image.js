// functions/ai-image.js — Minimal health/echo handler (CommonJS)
// Always returns 200 JSON so the browser never flags "endpoint failed".
// Use this to verify wiring; once confirmed, replace with your Replicate version.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400"
};

function reply200(obj) {
  return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  try {
    // Preflight
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

    // Parse POST body tolerantly
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const pingHeader = event.headers && (event.headers["x-ai-ping"] || event.headers["X-AI-Ping"]);

    // Echo payload (does NOT try to call Replicate)
    return reply200({
      ok: true,
      pong: !!(pingHeader || body.ping === true),
      method: event.httpMethod,
      path: event.path,
      receivedKeys: Object.keys(body || {}),
      // No image on purpose — this lets the client advance beyond "endpoint failed".
      note: "Health/echo handler; replace with Replicate version after you confirm 200 responses."
    });
  } catch (e) {
    // Still 200 so the client never treats it as an endpoint failure
    return reply200({ ok: false, error: e?.message || String(e) });
  }
};
