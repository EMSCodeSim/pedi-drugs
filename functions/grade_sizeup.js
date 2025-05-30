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

  const basePrompt = `You are a fire officer instructor grading a fire scene size-up report:
"${transcript}"

Grade the student using the following 10 categories. Each category is worth 1 point for a total of 10 points. 
For each category, respond with pass or fail, and describe the reason if failed.

Categories:
1. Identification & Command: unit ID and command assumed
2. Structure Description: type, occupancy, # of stories
3. Smoke/Fire Conditions: location, severity, visibility
4. Action Plan: offensive/defensive, side, crew actions
5. Additional Resources: mutual aid, ladder, EMS
6. Life Hazards/Victims: victim status or searches
7. Water Supply: source, relay, hydrant
8. Radio Comms: requests or confirms ops channel
9. Hazards & Exposures: power lines, collapse, propane, other risks
10. Incident Naming: assigns a name for command

Then give:
- Total score out of 10
- 2 improvement tips

Respond ONLY with JSON in this format:
{
  "score": 9,
  "items": [
    { "category": "Identification & Command", "desc": "Unit ID and command stated", "status": "pass" },
    { "category": "Hazards & Exposures", "desc": "Mentioned power lines or collapse risk", "status": "fail", "reason": "No mention of hazards or exposures" }
  ],
  "tips": [
    "Mention scene hazards like power lines or propane tanks.",
    "Assign a name to the incident for better communication clarity."
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a fire scene instructor grading scene size-ups." },
        { role: "user", content: basePrompt }
      ]
    });

    let content = response.choices[0].message.content;
    let jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      // Escalate to GPT-4 if 3.5 fails to return clean JSON
      const fallback = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "You are a fire scene instructor grading scene size-ups." },
          { role: "user", content: basePrompt }
        ]
      });

      content = fallback.choices[0].message.content;
      jsonMatch = content.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error("No valid JSON returned from GPT-4 fallback.");
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
