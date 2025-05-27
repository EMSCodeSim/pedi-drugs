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

  const basePrompt = `You are an NREMT instructor. Grade this handoff report from a student:
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
    { "category": "History", "desc": "Chief complaint, OPQRST, SAMPLE", "status": "fail", "reason": "Did not include SAMPLE" }
  ],
  "tips": [
    "Include SAMPLE history next time.",
    "State the time of call clearly at the beginning."
  ]
}`;

  try {
    // First try GPT-3.5 for cost-saving
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are an EMT instructor grading reports." },
        { role: "user", content: basePrompt }
      ]
    });

    let content = response.choices[0].message.content;
    let jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      // Escalate to GPT-4 Turbo if GPT-3.5 output is bad or missing
      const fallback = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "You are an EMT instructor grading reports." },
          { role: "user", content: basePrompt }
        ]
      });

      content = fallback.choices[0].message.content;
      jsonMatch = content.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error("No valid JSON from GPT-4 either.");
      }
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return { statusCode: 200, body: JSON.stringify(parsed) };

  } catch (error) {
    console.error("Grading error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Grading failed. GPT may not have returned clean JSON." })
    };
  }
};
