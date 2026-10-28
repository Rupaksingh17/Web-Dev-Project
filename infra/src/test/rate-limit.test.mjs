import assert from "node:assert/strict";
import test from "node:test";
import { consumeRateLimit, createRateLimitCommand } from "../rate-limit.mjs";

test("rate-limit keys hide source IPs and set a cleanup TTL", () => {
  const command = createRateLimitCommand({
    tableName: "reports",
    sourceIp: "203.0.113.7",
    action: "report",
    limit: 10,
    now: 1_800_000_000_000,
  });
  assert.match(command.input.Key.reportId, /^RATE#report#\d+#([a-f0-9]{64})$/);
  assert.equal(command.input.Key.reportId.includes("203.0.113.7"), false);
  assert.equal(command.input.ExpressionAttributeValues[":limit"], 10);
  assert.equal(command.input.ExpressionAttributeValues[":one"], 1);
  assert.match(command.input.UpdateExpression, /expiresAt/);
});

test("allows the configured number of requests and rejects the next one", async () => {
  const counts = new Map();
  const client = {
    async send(command) {
      const key = command.input.Key.reportId;
      const count = counts.get(key) ?? 0;
      if (count >= command.input.ExpressionAttributeValues[":limit"]) {
        throw Object.assign(new Error("limit reached"), { name: "ConditionalCheckFailedException" });
      }
      counts.set(key, count + 1);
    },
  };
  const request = {
    tableName: "reports",
    sourceIp: "203.0.113.7",
    action: "report",
    limit: 2,
    now: 1_800_000_000_000,
  };

  assert.equal(await consumeRateLimit(client, request), true);
  assert.equal(await consumeRateLimit(client, request), true);
  assert.equal(await consumeRateLimit(client, request), false);
  assert.equal(await consumeRateLimit(client, { ...request, sourceIp: "203.0.113.8" }), true);
});
