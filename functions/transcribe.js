const { OpenAI } = require("openai");
const busboy = require("busboy");
const fs = require("fs");
const os = require("os");
const path = require("path");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: event.headers });
    let filepath;

    bb.on("file", (_, file, info) => {
      const tmpPath = path.join(os.tmpdir(), info.filename);
      filepath = tmpPath;
      const writeStream = fs.createWriteStream(tmpPath);
      file.pipe(writeStream);
    });

    bb.on("finish", async () => {
      try {
        const response = await openai.audio.transcriptions.create({
          file: fs.createReadStream(filepath),
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

    const buffer = Buffer.from(event.body, "base64");
    bb.end(buffer);
  });
};
