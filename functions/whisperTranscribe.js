
const { OpenAI } = require("openai");
const multiparty = require("multiparty");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  return new Promise((resolve, reject) => {
    const form = new multiparty.Form();
    form.parse(event, async (err, fields, files) => {
      if (err) {
        return resolve({ statusCode: 500, body: JSON.stringify({ error: err.message }) });
      }

      const file = files.audio?.[0];
      if (!file) {
        return resolve({ statusCode: 400, body: JSON.stringify({ error: "No audio file uploaded." }) });
      }

      try {
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(file.path),
          model: "whisper-1"
        });

        resolve({
          statusCode: 200,
          body: JSON.stringify({ transcript: transcription.text })
        });
      } catch (error) {
        console.error("Whisper error:", error);
        resolve({ statusCode: 500, body: JSON.stringify({ error: "Transcription failed." }) });
      }
    });
  });
};
