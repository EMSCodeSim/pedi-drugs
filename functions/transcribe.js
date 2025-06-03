const { OpenAI } = require("openai");
const Busboy = require("busboy");
const fs = require("fs");
const os = require("os");
const path = require("path");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Netlify passes body as base64 string if binary
  const buffer = Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");

  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: {
        "content-type": event.headers["content-type"] || event.headers["Content-Type"],
      },
    });

    let audioFilePath = null;
    let audioFileStream = null;
    let uploadedFilename = "";
    let uploadedMimetype = "";

    busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
      // Log filename and mimetype for debugging
      uploadedFilename = filename;
      uploadedMimetype = mimetype;
      console.log("UPLOAD FILE:", filename, mimetype);

      // Write uploaded audio to a temp file
      const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${filename}`);
      audioFilePath = tmpPath;
      audioFileStream = fs.createWriteStream(tmpPath);
      file.pipe(audioFileStream);
    });

    busboy.on("finish", async () => {
      if (!audioFilePath) {
        resolve({
          statusCode: 400,
          body: JSON.stringify({ error: "No audio file found." }),
        });
        return;
      }
      try {
        // Log again after file is saved
        console.log("Saved file:", audioFilePath, "as", uploadedFilename, "type", uploadedMimetype);

        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(audioFilePath),
          model: "whisper-1",
        });
        resolve({
          statusCode: 200,
          body: JSON.stringify({ transcript: transcription.text }),
        });
      } catch (err) {
        console.error("Whisper failed:", err);
        resolve({
          statusCode: 500,
          body: JSON.stringify({
            error: "Whisper transcription failed.",
            debug: { filename: uploadedFilename, mimetype: uploadedMimetype }
          }),
        });
      } finally {
        fs.unlink(audioFilePath, () => {});
      }
    });

    busboy.end(buffer);
  });
};
