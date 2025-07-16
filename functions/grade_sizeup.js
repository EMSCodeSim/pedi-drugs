exports.handler = async (event) => {
  const { transcript } = JSON.parse(event.body || '{}');
  if (!transcript) {
    return { statusCode: 400, body: JSON.stringify({ error: "No transcript provided" }) };
  }

  const text = transcript.toLowerCase();
  const items = [];
  const tips = [];
  let score = 0;

  function evaluate(category, keywords, reason, passExample) {
    const matched = keywords.some(k => text.includes(k));
    items.push({
      category,
      status: matched ? 'pass' : 'fail',
      reason: matched ? '' : `${reason} Example: "${passExample}"`
    });
    if (!matched) tips.push(`Include: ${passExample}`);
    if (matched) score++;
  }

  evaluate("Unit ID & Arrival",
    ["medic", "ambulance", "on scene", "arrived"],
    "No mention of unit ID or arrival.",
    "Medic 2 is on scene."
  );

  evaluate("Scene Safety",
    ["scene is safe", "scene secure", "no hazards", "hazards present"],
    "No mention of scene safety.",
    "Scene is safe and secure."
  );

  evaluate("Mechanism of Injury",
    ["t-bone", "rollover", "rear ended", "vehicle hit", "head-on", "collision"],
    "No clear mechanism of injury stated.",
    "2-car T-bone collision."
  );

  evaluate("Vehicle Damage / Hazards",
    ["damage", "smoke", "fire", "fuel", "airbags", "entrapment", "hazards"],
    "No vehicle condition or hazards noted.",
    "Heavy front-end damage, airbag deployed."
  );

  evaluate("Patient Count & Severity",
    ["patient", "injured", "ambulatory", "walking", "critical", "unconscious", "alert"],
    "No mention of patient number or condition.",
    "Three patients, one unconscious."
  );

  evaluate("Resources Requested",
    ["request", "need", "additional", "backup", "extrication", "fire", "police", "second ambulance"],
    "No mention of additional resources needed or requested.",
    "Requesting a second ambulance and fire for extrication."
  );

  evaluate("Command Statement",
    ["establishing command", "assuming command", "i have command"],
    "No clear command statement.",
    "Establishing command at this time."
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ score: `${score}/7`, items, tips })
  };
};
