
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
      desc: "States unit ID and confirms arrival"
    },
    {
      category: "Vehicle Count",
      pass: /(one|two|three|multiple|\d+)\s+(vehicle|car|auto|SUV|truck)/.test(lower),
      desc: "Mentions number of vehicles involved"
    },
    {
      category: "Damage Description",
      pass: /(front-end|rear-end|side|rollover|head-on|t-bone|totaled|moderate|minor|severe|damage)/.test(lower),
      desc: "Describes vehicle damage type/severity"
    },
    {
      category: "Scene Hazards",
      pass: /(leaking|fuel|fire|traffic|power line|hazard|smoke|debris|fluid|live wire)/.test(lower),
      desc: "Mentions hazards (fire, fluid, traffic, etc.)"
    },
    {
      category: "Patient Info",
      pass: /(\d+|one|two|three|multiple)\s+(occupants|patients|people|victims)/.test(lower),
      desc: "States number and/or condition of occupants"
    },
    {
      category: "Resource Requests",
      pass: /(request|need|call).*?(ambulance|rescue|PD|police|tow|hazmat|additional)/.test(lower),
      desc: "Requests for support units (PD, EMS, tow)"
    },
    {
      category: "Initial Actions",
      pass: /(triage|extrication|stabilize|hazard control|assign command|scene secure|scene size-up)/.test(lower),
      desc: "Mentions initial actions like triage, stabilization, or command"
    },
    {
      category: "Command Establishment",
      pass: /command.*(established|assumed|initiated)/.test(lower),
      desc: "Declares command established or assumed"
    }
  ];

  let score = 0;
  const items = checks.map(c => {
    if (c.pass) {
      score++;
      return { category: c.category, status: "✅", desc: c.desc };
    } else {
      return { category: c.category, status: "❌", reason: "Missing: " + c.desc };
    }
  });

  const feedbackTips = items.filter(i => i.status === "❌").map(i => `• ${i.reason}`);
  const summary = `✅ ${score} of ${checks.length} key size-up elements completed.\n\n`;

  const feedback = summary + (feedbackTips.length
    ? "Suggested improvements:\n" + feedbackTips.join("\n")
    : "Excellent job covering all essential elements.");

  return {
    statusCode: 200,
    body: JSON.stringify({
      score,
      items,
      feedback
    })
  };
};
