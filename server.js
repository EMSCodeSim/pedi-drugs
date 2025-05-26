const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();

// Serve static files from the root
app.use(express.static(path.join(__dirname, '')));
app.use(express.json());

// Import routes
const whisper = require('./handoff/routes/whisperTranscribe');
const grade = require('./handoff/routes/gradeHandoff');

app.use('/', whisper);
app.use('/', grade);

app.listen(3000, () => {
  console.log('🚑 EMT Handoff Trainer running at http://localhost:3000');
});
