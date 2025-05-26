const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { transcript } = JSON.parse(event.body || '{}');
  if (!transcript) {
    return { statusCode: 400, body: JSON.stringify({ error: "No transcript provided." }) };
  }

  const prompt = `You are an NREMT instructor. Grade this handoff report from a student:
"${transcript}"

Score the student using the following categories. Each category is worth 8 points for a total of 40. 
For each category, respond with pass or fail, and describe the reason if failed.

Categories:
1. Demographics: age, sex, LOC, impression
2. History: chief complaint, OPQRST, SAMPLE
3. Assessment: vitals, skin, mental status
4. Interventions: oxygen, meds, CPR, ECG
5. Communication: time of call, clarity, follow-up, under 60 seconds

Then give:
- Total score out of 40
- 2 improvement tips

Respond ONLY with JSON in this format:
{
  "score": 36,
  "items": [
    { "category": "Demographics", "desc": "Age, sex, LOC, impression", "status": "pass" },
    { "category": "History", "desc": "Chief complaint, OPQRST, SAMPLE", "status": "fail", "reason": "Did not include SAMPLE" },
    ...
  ],
  "tips": [
    "Include SAMPLE history next time.",
    "State the time of call clearly at the beginning."
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "You are an EMT instructor grading reports." },
        { role: "user", content: prompt }
      ]
    });

    const content = response.choices[0].message.content;

    // Extract first valid JSON object from GPT response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No valid JSON block found in GPT response.");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      statusCode: 200,
      body: JSON.stringify(parsed)
    };

  } catch (error) {
    console.error("Grading error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Grading failed. GPT may not have returned clean JSON." })
    };
  }
};
