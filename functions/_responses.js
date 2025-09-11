// Small helper for JSON responses using the Web Fetch API
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...extraHeaders
    }
  });
}
