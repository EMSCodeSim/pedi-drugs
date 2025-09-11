export default async function handler(event) {
  try {
    const payload = event.body ? JSON.parse(event.body) : {};
    // TODO: implement generic grading
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, function: "grade", payload })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
}
