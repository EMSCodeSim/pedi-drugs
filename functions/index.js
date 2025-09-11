import { json } from "./_response.js";

export default async function handler(request, context) {
  return json({
    endpoints: [
      "/.netlify/functions/ping",
      "/.netlify/functions/grade",
      "/.netlify/functions/gradeSceneSizeup",
      "/.netlify/functions/grade_sizeup",
      "/.netlify/functions/openai_gpt",
      "/.netlify/functions/ai-image",
      "/.netlify/functions/transcribe"
    ]
  });
}
