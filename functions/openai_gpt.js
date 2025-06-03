const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const input = body.input || "";

    // Compose your prompt here!
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // or "gpt-4o"
      messages: [
        { role: "system", content: "You are a helpful assistant for EMS/Fire voice size-up grading." },
        { role: "user", content: input }
      ],
      max_tokens: 300,
      temperature: 0.2
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ result: completion.choices[0].message.content.trim() }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "OpenAI request failed", details: err.message }),
    };
  }
};
