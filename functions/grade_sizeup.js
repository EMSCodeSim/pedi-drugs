
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
      category: "Unit Identification and Arrival",
      pass: /(engine|ladder|truck|rescue|battalion|ambulance|medic)\s*\d+.*on scene/.test(lower),
      desc: "Clearly states the responding unit ID (e.g., 'Medic 5') and confirms their arrival on scene"
    },
    {
      category: "Vehicle Involvement",
      pass: /(one|two|three|multiple|\d+)\s+(vehicle|car|auto|SUV|truck)/.test(lower),
      desc: "Accurately identifies how many vehicles are involved in the collision"
    },
    {
      category: "Damage Description and Mechanism of Injury",
      pass: /(front-end|rear-end|side|rollover|head-on|t-bone|totaled|crumpled|severe|moderate|minor|damage)/.test(lower),
      desc: "Provides detail about type and severity of damage that may indicate mechanism of injury"
    },
    {
      category: "Hazards and Scene Safety",
      pass: /(leaking|fuel|fire|traffic|power line|hazard|smoke|debris|fluid|live wire|roadway blocked|airbags deployed)/.test(lower),
      desc: "Identifies hazards like fire, fluids, downed wires, traffic issues, or scene dangers"
    },
    {
      category: "Patient Count and Presentation",
      pass: /(\d+|one|two|three|multiple)\s+(occupants|patients|people|victims).*(injured|alert|trapped|ambulatory|responsive|unresponsive)?/.test(lower),
      desc: "Describes how many patients and gives brief info on their condition (e.g., alert, trapped)"
    },
    {
      category: "Resource Needs and Notifications",
      pass: /(request|need|call).*?(ambulance|rescue|PD|police|tow|hazmat|utility|additional unit|command)/.test(lower),
      desc: "Requests additional help or services like PD, EMS, utility company, or fire suppression"
    },
    {
      category: "Immediate Scene Actions",
      pass: /(triage|extrication|stabilize|hazard control|assign command|size-up complete|initial assessment|removed patient|secured vehicle)/.test(lower),
      desc: "Mentions actions like extrication, vehicle stabilization, triage, or securing the scene"
    },
    {
      category: "Command Structure",
      pass: /command.*(established|assumed|initiated)/.test(lower),
      desc: "Declares that incident command has been assumed or established on scene"
    }
  ];

  let score = 0;
  const results = checks.map(c => {
    if (c.pass) {
      score++;
      return { category: c.category, status: "✅", desc: c.desc };
    } else {
      return { category: c.category, status: "❌", reason: "Not clearly stated: " + c.desc };
    }
  });

  const missed = results.filter(i => i.status === "❌");
  const summary = `✅ You completed ${score} out of ${checks.length} essential elements of a proper MVA scene size-up.\n\n`;

  const feedback = summary + results.map(r =>
    `${r.status} ${r.category}: ${r.status === "✅" ? r.desc : r.reason}`
  ).join("\n") + (missed.length
    ? `\n\n🔧 Focus your improvement on these areas:\n${missed.map(m => "• " + m.reason).join("\n")}`
    : "\n\n🌟 Excellent work! You covered all the critical components of a scene size-up.");

  return {
    statusCode: 200,
    body: JSON.stringify({
      score,
      items: results,
      feedback
    })
  };
};
