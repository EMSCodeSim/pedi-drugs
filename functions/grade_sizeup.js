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

    // Fallback keywords for backup scoring
    const checklist = {
      unitArrival: ["on scene", "arrived", "ambulance on scene", "medic on scene"],
      vehicleCount: ["2 car", "multiple vehicle", "single vehicle", "head-on", "rear-end", "rollover"],
      patientInfo: ["1 patient", "2 patients", "multiple patients", "unresponsive", "walking wounded"],
      hazardMention: ["power lines", "fluid leak", "traffic hazard", "fire", "down lines"],
      additionalResources: ["request fire", "need pd", "hazmat", "air medical", "backup requested"],
      command: ["establish command", "assuming command", "incident command", "medical command"],
    };

    // Attempt GPT Grading
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

Respond ONLY in JSON like this:
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

    // Validate response content
    if (!raw || !raw.startsWith("{")) {
      throw new Error("GPT did not return valid JSON");
    }

    // Attempt safe JSON parse
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (jsonErr) {
      throw new Error("Invalid JSON returned from GPT: " + jsonErr.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(parsed),
    };

  } catch (err) {
    console.warn("⚠️ GPT Grading failed. Falling back. Reason:", err.message);

    // Fallback grading if GPT fails
    const fallbackResult = {
      items: [],
      score: 0,
      tips: [
        "Use clear language for unit arrival and hazards.",
        "Be specific about number of vehicles and patients.",
        "Mention if you're assuming command or need resources."
      ],
    };

    for (const [category, keywords] of Object.entries(checklist)) {
      const found = keywords.some(k => text.includes(k));
      fallbackResult.items.push({
        category,
        status: found ? "pass" : "fail",
        desc: `Expected mention of ${category}`,
        reason: found ? "" : `Example: "${keywords[0]}"`
      });
      if (found) fallbackResult.score++;
    }

    return {
      statusCode: 200,
      body: JSON.stringify(fallbackResult),
    };
  }
};
