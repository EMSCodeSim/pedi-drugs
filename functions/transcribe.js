import { OpenAI } from "openai";
import { Readable } from "stream";
import { parse } from "formidable";
import fs from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  return new Promise((resolve, reject) => {
    const form = new parse.IncomingForm({ multiples: false });

    form.parse({
      headers: event.headers,
      // convert the body buffer into a stream so formidable can process it
      // Netlify passes base64-encoded body string
      // Required for binary (audio) upload handling
      body: Buffer.from(event.body, "base64")
    }, async (err, fields, files) => {
      if (err) {
        console.error("Form parse error:", err);
        return resolve({
          statusCode: 400,
          body: JSON.stringify({ error: "Failed to parse audio form" }),
        });
      }

      const file = files.audio;
      if (!file) {
        return resolve({ statusCode: 400, body: JSON.stringify({ error: "No audio file found" }) });
      }

      try {
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(file.filepath),
          model: "whisper-1"
        });

        resolve({
          statusCode: 200,
          body: JSON.stringify({ transcript: transcription.text })
        });
      } catch (error) {
        console.error("Whisper error:", error);
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: "Whisper failed." })
        });
      }
    });
  });
};
