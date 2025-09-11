// functions/ai-image.js
// Cheapest-first compositor for your fire/smoke scenes.
//
// ✅ Now tries REPLICATE FIRST (low cost), then falls back to OpenAI if available.
// ✅ Default output locked to 1024x1024 (phone / projector sweet spot).
// ✅ Optional payload flag { highRes: true } to request 2048x2048 when needed.
// ✅ Returns JSON: { image: dataUrl[, overlay: dataUrl], model: "replicate"|"openai" }
//
// Expected POST body:
// { baseImageUrl, maskDataUrl, style, returnType, notes, overlaySummary, highRes? }

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPENAI_API_TOKEN ||
  "";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || "";

// Optional: pin a specific Replicate inpaint model/version (recommended)
const R_OWNER   = process.env.REPLICATE_OWNER   || "fofr";
const R_MODEL   = process.env.REPLICATE_MODEL   || "sdxl-inpainting";
const R_VERSION = process.env.REPLICATE_VERSION || ""; // paste model version hash here if you want it pinned

// Default sizes (keep costs predictable)
const SIZE_LOW  = "1024x1024";
const SIZE_HIGH = "2048x2048";

// If you ever want to force Replicate only (no fallback), set USE_REPLICATE_ONLY=1 in env.
const USE_REPLICATE_ONLY = (process.env.USE_REPLICATE_ONLY || "") === "1";

// -------- CORS / OPTIONS ----------
function cors(headers = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    ...headers
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return new Response("", { status: 204, headers: cors() });
  }
  if (event.httpMethod !== "POST") {
    return new Response("Use POST", { status: 405, headers: cors({ "content-type": "text/plain" }) });
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const {
      baseImageUrl,
      maskDataUrl,
      style = "realistic",
      returnType = "photo",
      notes = "",
      overlaySummary,
      highRes = false
    } = payload;

    if (!baseImageUrl || !maskDataUrl) {
      return new Response("Missing baseImageUrl or maskDataUrl", {
        status: 400, headers: cors({ "content-type": "text/plain" })
      });
    }

    const requestedSize = highRes ? SIZE_HIGH : SIZE_LOW;

    let pngBuffer, modelUsed;

    // -------------------- Replicate FIRST (cheap) --------------------
    try {
      if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN missing");
      ({ pngBuffer } = await replicateEdit({
        baseImageUrl, maskDataUrl, style, notes, overlaySummary, requestedSize
      }));
      modelUsed = "replicate";
    } catch (replicateErr) {
      if (USE_REPLICATE_ONLY) throw replicateErr; // explicit: don't fallback

      // -------------------- OpenAI fallback (if configured) --------------------
      if (!OPENAI_API_KEY) throw replicateErr;
      ({ pngBuffer } = await openaiEdit({
        baseImageUrl, maskDataUrl, style, notes, overlaySummary, requestedSize
      }));
      modelUsed = "openai";
    }

    const imageDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;

    // If caller wants overlay-only, clip composite with the mask as alpha
    if (returnType === "overlays") {
      const { buf: maskBuf } = await fetchAsBlob(maskDataUrl);
      const overlayBuf = await makeOverlayPNG(pngBuffer, maskBuf);
      const overlayDataUrl = `data:image/png;base64,${overlayBuf.toString("base64")}`;
      return new Response(JSON.stringify({ image: imageDataUrl, overlay: overlayDataUrl, model: modelUsed }), {
        status: 200, headers: cors({ "content-type": "application/json" })
      });
    }

    return new Response(JSON.stringify({ image: imageDataUrl, model: modelUsed }), {
      status: 200, headers: cors({ "content-type": "application/json" })
    });
  } catch (err) {
    console.error("ai-image error:", err);
    return new Response(`ai-image error: ${err.message || String(err)}`, {
      status: 500, headers: cors({ "content-type": "text/plain" })
    });
  }
}

// ---------- Shared helpers ----------
function styleToPrompt(style, notes, overlaySummary) {
  const parts = [];
  parts.push(
    "photojournalism-grade realism of a residential structure fire," +
      " preserve original building geometry and lens," +
      " add physically-plausible flames and volumetric smoke ONLY where masked," +
      " correct warm light spill on nearby surfaces, subtle reflections on glass," +
      " no new objects, no people, no vehicles"
  );
  if (style === "dramatic") {
    parts.push("cinematic contrast, crisp detail, intense glow but not neon");
  } else if (style === "training") {
    parts.push("daylight/overcast training drill, neutral grading, moderate contrast");
  } else {
    parts.push("natural grading, balanced saturation");
  }
  if (overlaySummary && typeof overlaySummary === "object") {
    const { fire = 0, smoke = 0 } = overlaySummary;
    if (fire || smoke) parts.push(`emphasize ${fire} flame region(s) and ${smoke} smoke region(s)`);
  }
  if (notes && notes.trim()) parts.push(notes.trim());
  parts.push("do not distort walls, windows, doors, rooflines; avoid oversaturated neon; avoid cartoon look");
  return parts.join(", ");
}

async function fetchAsBlob(urlOrDataUrl) {
  if (typeof urlOrDataUrl !== "string") throw new Error("Invalid image url");
  if (urlOrDataUrl.startsWith("data:")) {
    const [head, b64] = urlOrDataUrl.split(",");
    const mime = (head.match(/^data:(.+);base64$/) || [])[1] || "application/octet-stream";
    const buf = Buffer.from(b64, "base64");
    return { buf, mime, name: "image.png" };
  }
  const r = await fetch(urlOrDataUrl, { cache: "no-store" });
  if (!r.ok) throw new Error(`Fetch failed ${r.status}`);
  const mime = r.headers.get("content-type") || "application/octet-stream";
  const arr = new Uint8Array(await r.arrayBuffer());
  const ext = mime.includes("png") ? "png" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "bin";
  return { buf: Buffer.from(arr), mime, name: `image.${ext}` };
}

// ---------- OpenAI path (fallback) ----------
async function openaiEdit({ baseImageUrl, maskDataUrl, style, notes, overlaySummary, requestedSize }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing for OpenAI path");

  const form = new FormData();
  form.set("model", "gpt-image-1");
  form.set("prompt", styleToPrompt(style, notes, overlaySummary));
  form.set("size", requestedSize || SIZE_LOW); // 1024 by default

  const base = await fetchAsBlob(baseImageUrl);
  const mask = await fetchAsBlob(maskDataUrl);
  form.set("image", new File([base.buf], base.name, { type: base.mime }));
  form.set("mask",  new File([mask.buf], "mask.png", { type: "image/png" }));

  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`OpenAI error ${r.status}: ${txt}`);
  }
  const json = await r.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image");
  return { pngBuffer: Buffer.from(b64, "base64") };
}

// ---------- Replicate path (primary) ----------
async function replicateEdit({ baseImageUrl, maskDataUrl, style, notes, overlaySummary, requestedSize }) {
  if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN missing for Replicate path");

  const prompt = styleToPrompt(style, notes, overlaySummary);

  // Some SDXL inpaint models accept width/height; many infer from image.
  // We keep steps modest to control cost & preserve geometry.
  const input = {
    prompt,
    image: baseImageUrl,
    mask: maskDataUrl,
    prompt_strength: 0.55,     // lower = preserve structure
    guidance_scale: 5,
    num_inference_steps: 28
    // width / height can be added if your chosen model supports them
    // width: 1024, height: 1024  // uncomment if your model supports explicit sizing
  };

  const body = {
    version: R_VERSION || undefined, // if blank, model default latest is used
    input
  };

  const createUrl = "https://api.replicate.com/v1/predictions";
  const r = await fetch(createUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${REPLICATE_API_TOKEN}`
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Replicate create error ${r.status}: ${txt}`);
  }

  let pred = await r.json();
  for (let i = 0; i < 60; i++) {
    if (pred.status === "succeeded" || pred.status === "failed" || pred.status === "canceled") break;
    await new Promise((res) => setTimeout(res, 2000));
    const p = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` }
    });
    pred = await p.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate status: ${pred.status}`);

  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const out = await fetchAsBlob(outUrl);
  return { pngBuffer: out.buf };
}

// ---------- Overlay clip helper (mask -> alpha) ----------
async function makeOverlayPNG(compositePngBuffer, maskPngBuffer) {
  const sharp = (await import("sharp")).default;

  const comp = sharp(compositePngBuffer).ensureAlpha();
  const meta = await comp.metadata();

  const maskSharp = sharp(maskPngBuffer).ensureAlpha().toColourspace("b-w");
  const maskBuf   = await maskSharp.resize(meta.width, meta.height, { fit: "fill" }).toBuffer();

  const overlay = await comp
    .joinChannel(maskBuf)       // add mask as alpha
    .toColourspace("rgba")
    .toBuffer();

  // Zero RGB where alpha==0 to keep file size down
  const cleaned = await sharp(overlay)
    .removeAlpha()
    .joinChannel(await sharp(maskBuf).toColourspace("b-w").toBuffer())
    .toFormat("png")
    .toBuffer();

  return cleaned;
}
