// Convert your old CJS to ESM default export.
// Put your real grading logic inside the handler.

export default async function handler(event, context) {
  try {
    const input = event.body ? JSON.parse(event.body) : {};
    // TODO: your grading logic here
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, function: "grade_sizeup", input })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
}
