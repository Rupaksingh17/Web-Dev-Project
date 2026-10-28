import assert from "node:assert/strict";
import test from "node:test";

process.env.REPORTS_TABLE = "test-reports";
process.env.REPORTS_BUCKET = "test-photos";

const { handler } = await import("../handler.mjs");

const apiEvent = (body) => ({
  routeKey: "POST /reports",
  body,
  requestContext: { http: { sourceIp: "127.0.0.1" } },
});

test("rejects a JSON null report body with 400", async () => {
  const result = await handler(apiEvent("null"));
  assert.equal(result.statusCode, 400);
  assert.deepEqual(JSON.parse(result.body), { message: "Request body must be a JSON object." });
});

test("rejects a JSON array report body with 400", async () => {
  const result = await handler(apiEvent("[]"));
  assert.equal(result.statusCode, 400);
  assert.deepEqual(JSON.parse(result.body), { message: "Request body must be a JSON object." });
});

test("rejects malformed JSON with 400", async () => {
  const result = await handler(apiEvent("{"));
  assert.equal(result.statusCode, 400);
  assert.deepEqual(JSON.parse(result.body), { message: "Request body must be valid JSON." });
});

test("rejects unauthenticated administrator updates", async () => {
  const result = await handler({
    routeKey: "PATCH /reports/{reportId}",
    pathParameters: { reportId: "report-1" },
  });
  assert.equal(result.statusCode, 403);
});
