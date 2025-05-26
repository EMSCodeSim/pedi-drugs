
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { transcript } = JSON.parse(event.body || '{}');
  if (!transcript) {
    return { statusCode: 400, body: JSON.stringify({ error: "No transcript provided." }) };
  }

  const prompt = `You are an NREMT instructor grading an EMT-B student handoff report.
The student gave the following verbal handoff:
"""
${transcript}
"""
Grade it based on this 40-point rubric (2 points per correct item):
1. Patient age, sex, time of call, LOC, position found, general impression
2. Chief complaint, duration, OPQRST, SAMPLE, pertinent negatives, context
3. Assessment: findings, focused exam, vitals, skin, mental status
4. Interventions: oxygen, meds, CPR, ECG, reassess, med control, consent, documentation
5. Communication: condition during transport, clear structure, ED follow-up questions, answers provided, professional tone, under 60 sec
Give the total score out of 40. List what was done well and what was missed. Provide 2 improvement tips.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "You are an EMT instructor grading reports." },
        { role: "user", content: prompt }
      ]
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ feedback: response.choices[0].message.content })
    };
  } catch (error) {
    console.error("Grading error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Grading failed." })
    };
  }
};
