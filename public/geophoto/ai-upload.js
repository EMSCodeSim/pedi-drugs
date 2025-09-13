// functions/ai-image.js  — Netlify Functions v2 (ESM)
// Minimal, reliable handler to unblock the client.
// - Uses your existing functions/_response.js helper
// - Handles CORS + OPTIONS preflight
// - Accepts { dataUrl, image, guideURL, prompt, strength, ping }
// - Returns ONE final JSON with an `image` the client can display

import { json } from "./_response.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400"
};

export default async (request) => {
  try {
    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Only POST
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, CORS_HEADERS);
    }

    // Body (tolerant parse)
    let body = {};
    try { body = await request.json(); } catch {}

    // Ping path lets the client verify reachability quickly
    const pingHeader = request.headers.get("x-ai-ping");
    if (pingHeader || body.ping === true) {
      return json({ ok: true, pong: true, t: Date.now() }, 200, CORS_HEADERS);
    }

    const { dataUrl, image, guideURL, prompt, strength } = body || {};

    // Choose something the client can display
    const chosen =
      (typeof dataUrl === "string" && dataUrl.startsWith("data:image/") && dataUrl) ||
      (typeof image === "string" && image) ||
      (typeof guideURL === "string" && guideURL) ||
      null;

    if (!chosen) {
      return json(
        { ok: false, error: "No image provided (expected dataUrl, image, or guideURL)" },
        400,
        CORS_HEADERS
      );
    }

    // ✅ Echo back a usable image now. Replace with your real AI pipeline later.
    return json(
      {
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
      },
      200,
      CORS_HEADERS
    );
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500, CORS_HEADERS);
  }
};
