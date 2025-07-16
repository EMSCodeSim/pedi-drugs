exports.handler = async (event) => {
  try {
    console.log("Received event:", event);

    const { transcript } = JSON.parse(event.body || '{}');
    console.log("Transcript:", transcript);

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

    evaluate("Unit ID & Arrival", ["medic", "ambulance", "on scene"], "No mention of arrival.", "Medic 2 is on scene.");
    evaluate("Scene Safety", ["scene is safe", "scene secure", "hazard"], "Scene safety not mentioned.", "Scene is safe.");
    evaluate("Mechanism of Injury", ["t-bone", "rollover", "rear ended"], "MOI not mentioned.", "2-car T-bone collision.");
    evaluate("Vehicle Damage / Hazards", ["damage", "smoke", "fuel"], "No damage or hazard info.", "Front-end damage.");
    evaluate("Patient Count & Severity", ["patient", "injured", "ambulatory"], "No patient count/condition.", "Three patients.");
    evaluate("Resources Requested", ["request", "need", "backup"], "No resource request.", "Requesting second ambulance.");
    evaluate("Command Statement", ["establishing command"], "Command not stated.", "Establishing command.");

    const result = { score: `${score}/7`, items, tips };
    console.log("Result:", result);

    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };

  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error: " + err.message })
    };
  }
};
