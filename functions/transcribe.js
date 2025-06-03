const { OpenAI } = require("openai");
const multiparty = require("multiparty");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  // Netlify passes binary data as base64, so decode it
  const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");

  // Create a readable stream from the buffer for multiparty to parse
  // Simulate req with headers and body
  const req = {
    headers: event.headers,
    // Simulate stream interface
    pipe: (dest) => {
      dest.end(bodyBuffer);
    },
    on: () => {}, // Dummy for multiparty
  };

  // Parse the FormData
  const form = new multiparty.Form();

  return new Promise((resolve, reject) => {
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("Form parse error:", err);
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: "Form parse error" }),
        });
        return;
      }
      const audioFile = files.audio && files.audio[0];
      if (!audioFile) {
        resolve({
          statusCode: 400,
          body: JSON.stringify({ error: "No audio file provided" }),
        });
        return;
      }
      try {
        const response = await openai.audio.transcriptions.create({
          file: fs.createReadStream(audioFile.path),
          model: "whisper-1",
        });
        resolve({
          statusCode: 200,
          body: JSON.stringify({ transcript: response.text }),
        });
      } catch (error) {
        console.error("Whisper error:", error);
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: "Whisper failed." }),
        });
      }
    });
  });
};
