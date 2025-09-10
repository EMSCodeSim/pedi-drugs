// netlify/functions/ai-image.js
// Generates photoreal fire/smoke using your base image + mask.
// Prefers OpenAI gpt-image-1 edits; falls back to Replicate SDXL inpaint.
// Returns data URLs so your front-end can call saveAIResultToStorage(json.image).

export const config = { path: "/.netlify/functions/ai-image" };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN || "";
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || "";

const DEFAULT_SIZE = "2048x2048"; // OpenAI will internally resize/crop as needed.

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

function styleToPrompt(style, notes, overlaySummary) {
  const parts = [];
  // Base intent
  parts.push(
    "photojournalism-grade realism of a residential structure fire," +
      " preserve original building geometry, perspective and lens," +
      " add physically-plausible flames and volumetric smoke only where masked," +
      " correct light spill on nearby materials, subtle reflections on glass," +
      " no extra people, no trucks, no new objects"
  );

  if (style === "dramatic") {
    parts.push("cinematic contrast, crisp detail, intense glow but not neon");
  } else if (style === "training") {
    parts.push("daylight or overcast training drill look, moderate contrast, neutral grading");
  } else {
    parts.push("natural grading, balanced saturation");
  }

  if (overlaySummary && typeof overlaySummary === "object") {
    const { fire = 0, smoke = 0 } = overlaySummary;
    if (fire || smoke) {
      parts.push(`emphasize ${fire} flame region(s) and ${smoke} smoke region(s) as indicated by mask`);
    }
  }

  if (notes && notes.trim()) parts.push(notes.trim());

  // Guard rails (negatives)
  parts.push(
    "do not distort walls, windows, doors, rooflines," +
      " do not invent vehicles or firefighters, no text overlays," +
      " avoid oversaturated neon flames or cartoon effects"
  );

  return parts.join(", ");
}

/* ----------------------------- OpenAI path ----------------------------- */
async function openaiEdit({ baseImageUrl, maskDataUrl, style, notes, overlaySummary }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

  const prompt = styleToPrompt(style, notes, overlaySummary);

  // Build multipart form: image + mask + params
  const form = new FormData();
  form.set("model", "gpt-image-1");
  form.set("prompt", prompt);
  form.set("size", DEFAULT_SIZE);
  // Tip: if your scenes are dark/night often, uncomment:
  // form.set("background", "preserve"); // keeps original context where unmasked (API may ignore for composites)

  // Files
  const base = await fetchAsBlob(baseImageUrl);
  const mask = await fetchAsBlob(maskDataUrl);
  form.set("image", new File([base.buf], base.name, { type: base.mime }));
  form.set("mask", new File([mask.buf], "mask.png", { type: "image/png" }));

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
  const pngBuffer = Buffer.from(b64, "base64");
  return { pngBuffer };
}

/* --------------------------- Replicate fallback --------------------------- */
// NOTE: You can pin a specific inpainting model/version via env if you prefer.
// Example (SDXL inpaint community weights):
//   REPLICATE_OWNER="fofr"
//   REPLICATE_MODEL="sdxl-inpainting"
//   REPLICATE_VERSION="*model_version_hash*"
const R_OWNER = process.env.REPLICATE_OWNER || "stability-ai";
const R_MODEL = process.env.REPLICATE_MODEL || "stable-diffusion-3";
const R_VERSION = process.env.REPLICATE_VERSION || ""; // optional; use model default if blank

async function replicateEdit({ baseImageUrl, maskDataUrl, style, notes, overlaySummary }) {
  if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN missing");

  const prompt = styleToPrompt(style, notes, overlaySummary);

  // Replicate accepts URLs for image & mask; if you only have a data URL for mask,
  // we re-upload the dataURL to a signed file store. To keep this simple,
  // we’ll embed as data URLs directly (supported by most models).
  const input = {
    // Common SDXL/SD3 inpaint params across many community models:
    prompt,
    image: baseImageUrl,
    mask: maskDataUrl,
    // Try to keep geometry; lower strength keeps more of the original.
    prompt_strength: 0.55,
    guidance_scale: 5,
    num_inference_steps: 28
  };

  const body = {
    version: R_VERSION || undefined,
    input,
    // model path will be /v1/models/{owner}/{model}/versions/{version} when version is set,
    // but predictions endpoint accepts {version} at top-level too.
  };

  const r = await fetch("https://api.replicate.com/v1/predictions", {
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
  // Poll until done
  for (let i = 0; i < 60; i++) {
    if (pred.status === "succeeded" || pred.status === "failed" || pred.status === "canceled") break;
    await new Promise((res) => setTimeout(res, 2000));
    const p = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` }
    });
    pred = await p.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate status: ${pred.status}`);

  // Many models return an array of image URLs; take the first.
  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const out = await fetchAsBlob(outUrl);
  return { pngBuffer: out.buf };
}

/* ------------------------- Overlay (mask-clip) helper ------------------------- */
// If the caller wants "overlays", we turn the composite into a transparent PNG
// clipped to the white mask region. This overlay, when composited over the original,
// reproduces the edited area. (It’s not semantic-only flames, but it’s practical.)
async function makeOverlayPNG(compositePngBuffer, maskPngBuffer) {
  // Use Sharp to apply the mask as alpha.
  const sharp = (await import("sharp")).default;
  const comp = sharp(compositePngBuffer).ensureAlpha();
  const mask = sharp(maskPngBuffer).ensureAlpha().toColourspace("b-w"); // grayscale

  // Resize mask to composite size (just in case OpenAI resized)
  const meta = await comp.metadata();
  const maskBuf = await mask.resize(meta.width, meta.height, { fit: "fill" }).toBuffer();

  // Use mask as alpha channel:
  const overlay = await comp
    .joinChannel(maskBuf) // adds mask as extra channel
    .toColourspace("rgba")
    .toBuffer();

  // Now zero out RGB where alpha==0 to keep file tiny
  const cleaned = await sharp(overlay)
    .removeAlpha()
    .joinChannel(await sharp(maskBuf).toColourspace("b-w").toBuffer()) // put alpha back as the grayscale
    .toFormat("png")
    .toBuffer();

  return cleaned;
}

/* -------------------------------- HTTP handler -------------------------------- */
function okJSON(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      ...init.headers
    },
    ...init
  });
}
function errJSON(message, status = 400) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain",
      "access-control-allow-origin": "*"
    }
  });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return okJSON({ ok: true });

  if (event.httpMethod !== "POST") {
    return errJSON("Use POST with JSON { baseImageUrl, maskDataUrl, style, returnType, notes, overlaySummary }", 405);
  }

  try {
    const { baseImageUrl, maskDataUrl, style = "realistic", returnType = "photo", notes = "", overlaySummary } =
      JSON.parse(event.body || "{}");

    if (!baseImageUrl || !maskDataUrl) return errJSON("Missing baseImageUrl or maskDataUrl", 400);

    // Try OpenAI first, then Replicate.
    let result;
    try {
      result = await openaiEdit({ baseImageUrl, maskDataUrl, style, notes, overlaySummary });
    } catch (e1) {
      if (!REPLICATE_API_TOKEN) throw e1;
      result = await replicateEdit({ baseImageUrl, maskDataUrl, style, notes, overlaySummary });
    }

    const { pngBuffer } = result;
    const imageDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;

    if (returnType === "overlays") {
      // Build overlay by clipping composite to mask as alpha
      const maskBlob = await fetchAsBlob(maskDataUrl);
      const overlayBuf = await makeOverlayPNG(pngBuffer, maskBlob.buf);
      const overlayDataUrl = `data:image/png;base64,${overlayBuf.toString("base64")}`;
      return okJSON({ image: imageDataUrl, overlay: overlayDataUrl, model: OPENAI_API_KEY ? "openai" : "replicate" });
    }

    return okJSON({ image: imageDataUrl, model: OPENAI_API_KEY ? "openai" : "replicate" });
  } catch (err) {
    return errJSON(`ai-image error: ${err.message || String(err)}`, 500);
  }
}
