// netlify/functions/ai-image.js  (ESM, fuller version)
// Purpose: be robust AND unblock the UI
// - Handles CORS + OPTIONS preflight
// - Accepts { dataUrl, image, guideURL, prompt, strength, ... } from the client
// - Two modes:
//   1) PROXY MODE (recommended): If AI_UPSTREAM_URL is set, forward the payload to it
//      and return its JSON. Optionally send AI_UPSTREAM_KEY (as Authorization: Bearer).
//   2) ECHO MODE (fallback): If no upstream is configured, immediately echo a usable image
//      (dataUrl, image, or guideURL) so the client moves past “AI: streaming…”.
//
// Notes:
// - This function returns ONE final JSON. If you want progress, do it client-side or via polling.
// - Keep responses consistent: { ok: true, image: "<abs or data URL>", ... }

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400"
};

const AI_UPSTREAM_URL = process.env.AI_UPSTREAM_URL || null;
// If your upstream needs a key, set ONE of these:
//   AI_UPSTREAM_KEY       -> sent as Authorization: Bearer <key>
//   AI_UPSTREAM_X_API_KEY -> sent as x-api-key: <key>
const AI_UPSTREAM_KEY = process.env.AI_UPSTREAM_KEY || null;
const AI_UPSTREAM_X_API_KEY = process.env.AI_UPSTREAM_X_API_KEY || null;

// ---------- helpers ----------
function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj)
  };
}

function pickUsableImage({ dataUrl, image, guideURL }) {
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) return dataUrl;
  if (typeof image === "string" && image) return image;
  if (typeof guideURL === "string" && guideURL) return guideURL;
  return null;
}

function resolveAgainst(base, maybeRelative) {
  try {
    if (!maybeRelative || typeof maybeRelative !== "string") return maybeRelative;
    if (/^https?:\/\//i.test(maybeRelative) || maybeRelative.startsWith("data:image/")) return maybeRelative;
    return new URL(maybeRelative, base).href;
  } catch {
    return maybeRelative;
  }
}

async function readJSONSafe(resp) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: "non-JSON upstream response", raw: text.slice(0, 500) }; }
}

// ---------- handler ----------
export async function handler(event, _context) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  // Only POST
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  // Ping path lets the client verify reachability quickly
  const pingHeader = event.headers?.["x-ai-ping"] || event.headers?.["X-AI-Ping"] || null;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  if (pingHeader || body.ping === true) {
    return json(200, { ok: true, pong: true, t: Date.now() });
  }

  // Extract common fields (but we forward everything in proxy mode)
  const {
    dataUrl,
    image,
    guideURL,
    prompt,
    strength,
    ...rest
  } = body || {};

  // ---------- PROXY MODE ----------
  if (AI_UPSTREAM_URL) {
    // Build the payload we send upstream. Include everything the client sent
    // plus a normalized "image" (servers often expect req.body.image).
    const chosen = pickUsableImage({ dataUrl, image, guideURL });
    const upstreamPayload = {
      ...rest,
      dataUrl: dataUrl || null,
      image: chosen || image || null,
      guideURL: guideURL || null,
      prompt: prompt || "",
      strength: typeof strength === "number" ? strength : undefined
    };

    // Prepare headers
    const hdrs = { "content-type": "application/json" };
    if (AI_UPSTREAM_KEY) hdrs["authorization"] = `Bearer ${AI_UPSTREAM_KEY}`;
    if (AI_UPSTREAM_X_API_KEY) hdrs["x-api-key"] = AI_UPSTREAM_X_API_KEY;

    // Timeout & fetch
    const ctl = new AbortController();
    const HARD_MS = 120000; // 2 min
    const timer = setTimeout(() => ctl.abort(), HARD_MS);

    let resp;
    try {
      resp = await fetch(AI_UPSTREAM_URL, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(upstreamPayload),
        signal: ctl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      // Fall back to echo so the UI still completes
      const fallback = pickUsableImage({ dataUrl, image, guideURL });
      if (!fallback) {
        return json(502, { ok: false, error: "Upstream unreachable and no image to echo", detail: String(e) });
      }
      return json(200, {
        ok: true,
        image: fallback,
        mode: "photo",
        upstream_error: "fetch_failed",
        detail: String(e)
      });
    }

    clearTimeout(timer);

    // Read upstream JSON (non-streaming)
    const result = await readJSONSafe(resp);
    if (!resp.ok) {
      // Still try to salvage a usable image if present
      const maybe = pickUsableImage({ dataUrl, image, guideURL });
      return json(resp.status, {
        ok: false,
        error: "Upstream error",
        status: resp.status,
        upstream: result,
        ...(maybe ? { echoed: true, image: maybe } : {})
      });
    }

    // Normalize result: prefer url/result/output/image/compositeURL
    const upstreamBase = AI_UPSTREAM_URL;
    const candidate =
      result?.url ||
      result?.result ||
      result?.output ||
      result?.image_url ||
      result?.image ||
      result?.compositeURL ||
      result?.composited_url ||
      null;

    let finalImage = null;
    if (typeof candidate === "string" && candidate) {
      finalImage = resolveAgainst(upstreamBase, candidate);
    } else if (typeof result?.dataURL === "string" && result.dataURL.startsWith("data:image/")) {
      finalImage = result.dataURL;
    } else if (typeof result?.data_url === "string" && result.data_url.startsWith("data:image/")) {
      finalImage = result.data_url;
    }

    // If upstream returned no usable image, echo client input to keep UX flowing
    if (!finalImage) {
      const fallback = pickUsableImage({ dataUrl, image, guideURL });
      if (!fallback) {
        return json(500, { ok: false, error: "Upstream returned no image and no fallback available", upstream: result });
      }
      return json(200, { ok: true, image: fallback, upstream_note: "no_image_in_response_fallback" });
    }

    return json(200, { ok: true, image: finalImage, upstream_ok: true });
  }

  // ---------- ECHO MODE ----------
  // No upstream configured → just echo something the client can show
  const chosen = pickUsableImage({ dataUrl, image, guideURL });
  if (!chosen) {
    return json(400, {
      ok: false,
      error: "No image provided (expected dataUrl, image, or guideURL). Set AI_UPSTREAM_URL to call your AI service."
    });
  }

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
}
