// Netlify Functions v2 (ESM): (request) => Response
// - Uses FLUX Fill (inpaint) when a mask is provided
// - Otherwise echoes the provided image back as a data URL
// - No server-side bucket uploads; the client uploads to Firebase

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "POST")    return json({ ok:false, error:"Use POST" }, 405);

    let p; try { p = await request.json(); } catch { return json({ ok:false, error:"Invalid JSON body" }, 400); }

    // Accept legacy and new fields
    const mode   = p.mode || null;
    const image  = p.image || p.dataUrl || p.guideUrl || null; // URL or data URL
    const mask   = p.mask  || p.maskDataUrl || null;
    const prompt = (p.prompt || "").trim();
    if (!image) return json({ ok:false, error:"Provide image (URL or data URL)." }, 400);

    const AI_MODE = process.env.AI_MODE || (process.env.REPLICATE_API_TOKEN ? "replicate" : "echo");

    // If mask is present and Replicate is configured → use FLUX Fill
    if (mask && AI_MODE === "replicate") {
      const token = process.env.REPLICATE_API_TOKEN;
      if (!token) return json({ ok:false, error:"Missing REPLICATE_API_TOKEN" }, 500);

      const owner = process.env.REPLICATE_MODEL_OWNER || "black-forest-labs";
      const name  = process.env.REPLICATE_MODEL_NAME  || "flux-fill-dev"; // inpainting
      const createURL = `https://api.replicate.com/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`;

      const createResp = await fetch(createURL, {
        method: "POST",
        headers: { "Authorization": `Token ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: {
            prompt: prompt || "make edits that blend naturally",
            image,  // URL or data URL of the base image
            mask    // data URL: white = change, black = keep
          }
        })
      });
      if (!createResp.ok) {
        const t = await createResp.text().catch(()=> "");
        return json({ ok:false, error:`Replicate create failed: ${t || createResp.statusText}` }, createResp.status);
      }
      const created = await createResp.json();
      const pollURL = created?.urls?.get || created?.href;
      if (!pollURL) return json({ ok:false, error:"Replicate did not return a poll URL." }, 502);

      const started = Date.now();
      let outputUrl = null;
      while (Date.now() - started < 90000) {
        await sleep(1200);
        const poll = await fetch(pollURL, { headers: { "Authorization": `Token ${token}` } });
        if (!poll.ok) {
          const t = await poll.text().catch(()=> "");
          return json({ ok:false, error:`Replicate poll failed: ${t || poll.statusText}` }, poll.status);
        }
        const j = await poll.json();
        if (j.status === "succeeded") {
          const out = j.output;
          outputUrl = Array.isArray(out) ? out[out.length-1] : (typeof out === "string" ? out : out?.image || null);
          break;
        }
        if (j.status === "failed" || j.status === "canceled") {
          return json({ ok:false, error:`Replicate job ${j.status}. ${j.error || ""}`.trim() }, 502);
        }
      }
      if (!outputUrl) return json({ ok:false, error:"Timed out waiting for Replicate output." }, 504);
      return json({ ok:true, image:{ url: outputUrl }, mode:"replicate-fill" });
    }

    // No mask or no Replicate token → echo back an image the client can upload
    const outDataUrl = await toDataURL(image);
    return json({ ok:true, image: outDataUrl, mode: mask ? "echo-fill" : (mode === "echo" ? "echo" : "pass-through") });

  } catch (err) {
    return json({ ok:false, error: err?.message || String(err) }, 500);
  }
};

/* ---------- helpers ---------- */
function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS_HEADERS, "Content-Type":"application/json; charset=utf-8" }});
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function toDataURL(urlOrData){
  const s = String(urlOrData||'');
  if (s.startsWith('data:')) return s;
  const r = await fetch(s, { cache:"no-store" });
  if (!r.ok) throw new Error(`Guide fetch failed: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = r.headers.get("content-type") || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
