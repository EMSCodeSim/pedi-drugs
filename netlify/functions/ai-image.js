// netlify/functions/ai-image.js
/* eslint-disable */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  try {
    const {
      baseImageUrl,
      maskDataUrl,           // data:image/png;base64,...
      style = 'realistic',   // realistic | dramatic | training
      returnType = 'photo',  // photo | overlays
      notes = '',
      overlaySummary = {},   // { fire:3, smoke:2, people:1, cars:0, hazard:0 }
    } = JSON.parse(event.body || '{}');

    if (!process.env.OPENAI_API_KEY) {
      return { statusCode: 500, headers: CORS, body: 'Missing OPENAI_API_KEY' };
    }
    if (!baseImageUrl || !maskDataUrl) {
      return { statusCode: 400, headers: CORS, body: 'Missing baseImageUrl or maskDataUrl' };
    }

    // Fetch base image
    const imgRes = await fetch(baseImageUrl, { cache: 'no-store' });
    if (!imgRes.ok) {
      return { statusCode: 400, headers: CORS, body: `Could not fetch base image: ${imgRes.status}` };
    }
    const baseArray = new Uint8Array(await imgRes.arrayBuffer());

    // Decode mask (data URL -> Buffer)
    function dataURLtoUint8(u) {
      const i = u.indexOf(',');
      const b64 = u.slice(i + 1);
      return Uint8Array.from(Buffer.from(b64, 'base64'));
    }
    const maskArray = dataURLtoUint8(maskDataUrl);

    // Build prompt from overlaySummary + style + notes
    const parts = [];
    const map = { fire: 'realistic fire', smoke: 'smoke', people: 'bystanders/rescuers', cars: 'vehicles', hazard: 'hazards' };
    for (const [k, v] of Object.entries(overlaySummary || {})) {
      if (v > 0 && map[k]) parts.push(`${v}× ${map[k]}`);
    }
    const summary = parts.length ? parts.join(', ') : 'scene elements';
    const styleText =
      style === 'dramatic' ? 'cinematic, dramatic lighting' :
      style === 'training' ? 'clear daylight, training drill aesthetic' :
      'natural, photo-realistic lighting';
    const prompt =
      `${notes ? notes + '. ' : ''}Within ONLY the masked regions, add ${summary}. ` +
      `Match perspective, scale, and shadows to the original photo; preserve the unmasked areas exactly. ` +
      `Style: ${styleText}.`;

    // Compose multipart request to OpenAI images edits
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('image', new Blob([baseArray], { type: 'image/jpeg' }), 'base.jpg');
    form.append('mask',  new Blob([maskArray], { type: 'image/png'  }), 'mask.png');
    form.append('prompt', prompt);
    if (returnType === 'overlays') form.append('background', 'transparent');
    form.append('size', '1024x1024');

    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { statusCode: r.status, headers: CORS, body: `OpenAI error: ${txt}` };
    }

    const json = await r.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) {
      return { statusCode: 500, headers: CORS, body: 'No image from OpenAI' };
    }

    // Return a Data URL for easy client handling
    const mime = returnType === 'overlays' ? 'image/png' : 'image/png';
    const dataUrl = `data:${mime};base64,${b64}`;
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, image: dataUrl }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: `Server error: ${e.message || e}` };
  }
};
