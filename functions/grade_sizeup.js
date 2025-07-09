const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    const { transcript } = JSON.parse(event.body);
    const text = transcript.toLowerCase();

    // Fallback checklist for keyword backup
    const checklist = {
      unitArrival: ["on scene", "arrived", "ambulance on scene", "medic on scene"],
      vehicleCount: ["2 car", "multiple vehicle", "single vehicle", "head-on", "rear-end", "rollover"],
      patientInfo: ["1 patient", "2 patients", "multiple patients", "unresponsive", "walking wounded"],
      hazardMention: ["power lines", "fluid leak", "traffic hazard", "fire", "down lines"],
      additionalResources: ["request fire", "need pd", "hazmat", "air medical", "backup requested"],
      command: ["establish command", "assuming command", "incident command", "medical command"],
    };

    // GPT attempt
    const gpt = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: "You are a paramedic supervisor grading a real-world radio size-up of an MVA scene.",
        },
        {
          role: "user",
          content: `
A crew just gave the following radio size-up:

"${transcript}"

Evaluate this size-up based on:
1. Confirm unit is on scene
2. Describe number of vehicles and damage
3. Mention any scene hazards
4. State number and condition of patients
5. Call for needed resources
6. Assume or confirm command

For each item:
- Mark pass or fail
- Provide a brief comment (reason)

Then summarize with:
- Total score out of 6
- 2–3 improvement tips

Respond in this JSON format:
{
  "items": [
    { "category": "Unit Arrival", "status": "pass", "desc": "Crew confirmed arrival", "reason": "" },
    ...
  ],
  "score": 5,
  "tips": ["Use clearer description of vehicle damage", "Mention hazards explicitly"]
}
        `,
        },
      ],
      temperature: 0.3,
    });

    const raw = gpt.choices?.[0]?.message?.content?.trim();

    // Validate if response starts with expected JSON
    if (!raw || !raw.startsWith("{")) {
      throw new Error("GPT response was not JSON");
    }

    const parsed = JSON.parse(raw);
    return {
      statusCode: 200,
      body: JSON.stringify(parsed),
    };

  } catch (err) {
    console.warn("GPT failed or invalid JSON. Falling back. Error:", err.message);

    // Fallback grading logic
    const fallbackResult = {
      items: [],
      score: 0,
      tips: [],
    };

    for (const [category, keywords] of Object.entries(checklist)) {
      const found = keywords.some(keyword => text.includes(keyword));
      fallbackResult.items.push({
        category,
        status: found ? "pass" : "fail",
        desc: `Check for ${category}`,
        reason: found ? "" : `Expected phrase like "${keywords[0]}"`,
      });
      if (found) fallbackResult.score++;
    }

    fallbackResult.tips = [
      "Use clear radio language to describe vehicles and hazards.",
      "State if additional help is needed.",
      "Always confirm you're on scene at the start of your report."
    ];

    return {
      statusCode: 200,
      body: JSON.stringify(fallbackResult),
    };
  }
};
