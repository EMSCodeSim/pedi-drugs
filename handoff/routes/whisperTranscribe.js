const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { OpenAI } = require('openai');
const router = express.Router();

const upload = multer({ dest: 'uploads/' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const audioPath = req.file.path;

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1'
    });

    console.log("Whisper response:", transcription);

    const result = transcription.text || "Whisper did not return a result.";
    res.json({ transcript: result });

    fs.unlinkSync(audioPath); // Clean up the uploaded file

  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Transcription failed. Check Whisper config or audio input.' });
  }
});

module.exports = router;
