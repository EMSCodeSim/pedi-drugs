
const { ChatGPTAPI } = require("chatgpt");

exports.handler = async function(event, context) {
  const body = JSON.parse(event.body || '{}');
  const transcript = body.transcript;
  if (!transcript) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "No transcript provided." })
    };
  }

  const lower = transcript.toLowerCase();

  const checks = [
    {
      category: "Unit Identification",
      pass: /(engine|ladder|truck|rescue|battalion)\s*\d+.*on scene/.test(lower),
      desc: "States unit and confirms arrival (e.g., 'Engine 3 on scene')"
    },
    {
      category: "Number of Vehicles Involved",
      pass: /(one|two|three|multiple|\d+)\s+(vehicle|car|auto|SUV|truck)/.test(lower),
      desc: "Mentions number of vehicles involved"
    },
    {
      category: "Vehicle Condition Description",
      pass: /(front-end|rear-end|side|rollover|severe|moderate|minor|damage)/.test(lower),
      desc: "Describes visible damage to vehicles"
    },
    {
      category: "Scene Safety Hazards",
      pass: /(leaking fuel|down(ed)? power line|traffic|hazard|fire|smoke|debris|fluid)/.test(lower),
      desc: "Mentions scene hazards such as fluids, traffic, wires, or fire"
    },
    {
      category: "Number & Status of Patients",
      pass: /(one|two|three|multiple|\d+)\s+(patient|victim|occupant)/.test(lower),
      desc: "Mentions how many patients and their conditions"
    },
    {
      category: "Need for Additional Resources",
      pass: /(request|need|call).*?(ambulance|rescue|PD|police|tow|hazmat)/.test(lower),
      desc: "Requests or mentions other units needed"
    },
    {
      category: "Initial Actions Taken",
      pass: /(triage|extrication|stabilize|hazard control|hazard mitigation|assign command|patient care)/.test(lower),
      desc: "Mentions any immediate actions taken"
    },
    {
      category: "Command Declaration",
      pass: /(command).*(established|assumed)/.test(lower),
      desc: "Declares or assumes incident command"
    }
  ];

  let score = 0;
  const items = checks.map(c => {
    if (c.pass) {
      score++;
      return { category: c.category, status: "✅", desc: c.desc };
    } else {
      return { category: c.category, status: "❌", reason: "Missing or unclear: " + c.desc };
    }
  });

  const tips = items.filter(i => i.status === "❌").map(i => "Tip: " + i.reason);

  // GPT-style explanation
  const feedback = `You completed ${score} out of ${checks.length} critical MVA scene size-up components.
${items.map(i => i.status === "✅" ? `✅ ${i.category}: ${i.desc}` : `❌ ${i.category}: ${i.reason}`).join("\n")}
\n
Here are improvement tips to focus on:
${tips.join("\n")}`;

  return {
    statusCode: 200,
    body: JSON.stringify({
      score,
      items,
      tips,
      feedback
    })
  };
};
