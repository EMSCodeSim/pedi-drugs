// Optional: a simple index for sanity checks
export default async function handler(event) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoints: [
        "/.netlify/functions/ping",
        "/.netlify/functions/grade",
        "/.netlify/functions/gradeSceneSizeup",
        "/.netlify/functions/grade_sizeup",
        "/.netlify/functions/openai_gpt",
        "/.netlify/functions/ai-image",
        "/.netlify/functions/transcribe"
      ]
    })
  };
}
