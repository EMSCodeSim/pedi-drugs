import { json } from "./_response.js";
import Replicate from "replicate";

// ✅ set your model here (owner/name, no version hash)
const MODEL = process.env.REPLICATE_MODEL || "stability-ai/sdxl";
// Examples you can try (depending on your account access):
//   "stability-ai/sdxl"
//   "stability-ai/sdxl-turbo"
//   "black-forest-labs/flux-1.1-pro"

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function splitModel(full) {
  const parts = String(full || "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`MODEL must be "owner/name", got "${full}"`);
  }
  return { owner: parts[0], name: parts[1] };
}

async function getLatestVersionId(owner, name, token) {
  const res = await fetch(`https://api.replicate.com/v1/models/${owner}/${name}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Unable to resolve latest version for ${owner}/${name} (HTTP ${res.status}). ${detail}`
    );
  }
  const data = await res.json();
  const id = data?.latest_version?.id;
  if (!id) {
    throw new Error(`Model ${owner}/${name} has no latest_version.id in response.`);
  }
  return id;
}

export default async function handler(request) {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      throw new Error("Missing REPLICATE_API_TOKEN env var");
    }

    const { owner, name } = splitModel(MODEL);

    const body = request.method === "POST" ? await request.json() : {};
    const prompt = body?.prompt ?? "a realistic fire scene (placeholder)";
    const input = body?.input && typeof body.input === "object" ? body.input : { prompt };

    // 🔎 Resolve version id robustly (no undefined)
    const version = await getLatestVersionId(owner, name, process.env.REPLICATE_API_TOKEN);

    // ▶️ Run model with resolved version
    const output = await replicate.run(`${owner}/${name}:${version}`, { input });

    return json({ ok: true, model: `${owner}/${name}`, version, output });
  } catch (e) {
    const msg = String(e?.message || e);
    const likely =
      /not permitted|permission|does not exist|not found|invalid version/i.test(msg)
        ? "Check that your token has access to this model (some require a paid plan) and that the model name is correct."
        : undefined;

    return json(
      {
        ok: false,
        error: msg,
        hint: likely,
        // Uncomment for temporary debugging:
        // stack: e?.stack
      },
      500
    );
  }
}
