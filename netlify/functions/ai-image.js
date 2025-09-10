// functions/ai-image.js
// Photoreal fire/smoke compositor:
// - Accepts { baseImageUrl, maskDataUrl, style, returnType, notes, overlaySummary }
// - Tries OpenAI "gpt-image-1" edits first (needs OPENAI_API_KEY)
// - Falls back to Replicate inpainting (needs REPLICATE_API_TOKEN)
// - Returns JSON: { image: dataUrl[, overlay: dataUrl], model: "openai"|"replicate" }

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ||
  process.env.OPENAI_API_TOKEN ||
  "";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || "";

// Optional: pin a specific Replicate model/version:
const R_OWNER = process.env.REPLICATE_OWNER || "fofr";
const R_MODEL = process.env.REPLICATE_MODEL || "sdxl-inpainting";
const R_VERSION = process.env.REPLICATE_VERSION || ""; // version hash from model page, or leave blank

const DEFAULT_SIZE = "2048x2048";

// -------- CORS / OPTIONS ----------
function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    ...extra
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders() });
  }
  if (event.httpMethod !== "POST") {
    return new Response("Use POST", {
      status: 405,
      headers: corsHeaders({ "content-type": "text/plain" })
    });
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const {
      baseImageUrl,
      maskDataUrl,
      style = "realistic",
      returnType = "photo",
      notes = "",
      overlaySummary
    } = payload;

    if (!baseImageUrl || !maskDataUrl) {
      return new Response("Missing baseImageUrl or maskDataUrl", {
        status: 400,
        headers: corsHeaders({ "content-type": "text/plain" })
      });
    }

    // Try OpenAI, else Replicate
    let pngBuffer, modelUsed;
    try {
      ({ pngBuffer } = await openaiEdit({
        baseImageUrl,
        maskDataUrl,
        style,
        notes,
        overlaySummary
      }));
      modelUsed = "openai";
    } catch (e1) {
      if (!REPLICATE_API_TOKEN) throw e1;
      ({ pngBuffer } = await replicateEdit({
        baseImageUrl,
        maskDataUrl,
        style,
        notes,
        overlaySummary
      }));
      modelUsed = "replicate";
    }

    const imageDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;

    // If the caller wants "overlays", clip composite by the mask as alpha
    if (returnType === "overlays") {
      const { buf: maskBuf } = await fetchAsBlob(maskDataUrl);
      const overlayBuf = await makeOverlayPNG(pngBuffer, maskBuf);
      const overlayDataUrl = `data:image/png;base64,${overlayBuf.toString("base64")}`;
      return new Response(
        JSON.stringify({ image: imageDataUrl, overlay: overlayDataUrl, model: modelUsed }),
        { status: 200, headers: corsHeaders({ "content-type": "application/json" }) }
      );
    }

    return new Response(
      JSON.stringify({ image: imageDataUrl, model: modelUsed }),
      { status: 200, headers: corsHeaders({ "content-type": "application/json" }) }
    );
  } catch (err) {
    console.error("ai-image error:", err);
    return new Response(`ai-image error: ${err.message || String(err)}`, {
      status: 500,
      headers: corsHeaders({ "content-type": "text/plain" })
    });
  }
}

// ---------- Helpers ----------
function styleToPrompt(style, notes, overlaySummary) {
  const parts = [];
  parts.push(
    "photojournalism-grade realism of a residential structure fire," +
      " preserve original building geometry, perspective and lens," +
      " add physically-plausible flames and volumetric smoke only where masked," +
      " correct warm light spill on nearby materials, subtle glass reflections," +
      " no new objects, no people, no trucks"
  );
  if (style === "dramatic") {
    parts.push("cinematic contrast, crisp detail, intense glow but not neon");
  } else if (style === "training") {
    parts.push("daylight or overcast training drill look, neutral grading, moderate contrast");
  } else {
    parts.push("natural grading, balanced saturation");
  }
  if (overlaySummary && typeof overlaySummary === "object") {
    const { fire = 0, smoke = 0 } = overlaySummary;
    if (fire || smoke) parts.push(`emphasize ${fire} flame region(s) and ${smoke} smoke region(s) as masked`);
  }
  if (notes && notes.trim()) parts.push(notes.trim());
  parts.push(
    "do not distort walls, windows, doors, rooflines; avoid oversaturated neon or cartoon effects"
  );
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

// ---------- OpenAI path ----------
async function openaiEdit({ baseImageUrl, maskDataUrl, style, notes, overlaySummary }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing for OpenAI path");

  const form = new FormData();
  form.set("model", "gpt-image-1");
  form.set("prompt", styleToPrompt(style, notes, overlaySummary));
  form.set("size", DEFAULT_SIZE);

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

// ---------- Replicate path ----------
async function replicateEdit({ baseImageUrl, maskDataUrl, style, notes, overlaySummary }) {
  if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN missing for Replicate path");

  const prompt = styleToPrompt(style, notes, overlaySummary);

  const body = {
    version: R_VERSION || undefined,
    // Many inpaint models accept "image" + "mask" + prompt-like params:
    input: {
      prompt,
      image: baseImageUrl,
      mask: maskDataUrl,
      // Tuning:
      // Lower keeps original geometry; higher allows more dramatic effects.
      prompt_strength: 0.55,
      guidance_scale: 5,
      num_inference_steps: 28
    }
  };

  // Build endpoint for predictions
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

  // Models often return an array of image URLs
  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const out = await fetchAsBlob(outUrl);
  return { pngBuffer: out.buf };
}

// ---------- Overlay clip helper (mask -> alpha) ----------
async function makeOverlayPNG(compositePngBuffer, maskPngBuffer) {
  const sharp = (await import("sharp")).default;

  const comp = sharp(compositePngBuffer).ensureAlpha();
  const meta = await comp.metadata();

  // Normalize mask to composite dims
  const maskSharp = sharp(maskPngBuffer).ensureAlpha().toColourspace("b-w");
  const maskBuf = await maskSharp.resize(meta.width, meta.height, { fit: "fill" }).toBuffer();

  // Apply mask as alpha
  const overlay = await comp
    .joinChannel(maskBuf)
    .toColourspace("rgba")
    .toBuffer();

  // Clean up: zero RGB where alpha = 0, to reduce size
  const cleaned = await sharp(overlay)
    .removeAlpha()
    .joinChannel(await sharp(maskBuf).toColourspace("b-w").toBuffer())
    .toFormat("png")
    .toBuffer();

  return cleaned;
}
