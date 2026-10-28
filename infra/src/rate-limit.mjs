import { createHash } from "node:crypto";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

const WINDOW_SECONDS = 60 * 60;

export function createRateLimitCommand({ tableName, principalId, sourceIp, action, limit, now = Date.now() }) {
  const identity = principalId || sourceIp;
  if (!tableName || !identity || !action || !Number.isInteger(limit) || limit < 1) {
    throw new TypeError("A table, user identity, action, and positive limit are required.");
  }

  const window = Math.floor(Math.floor(now / 1000) / WINDOW_SECONDS);
  const identityHash = createHash("sha256").update(identity).digest("hex");
  return new UpdateCommand({
    TableName: tableName,
    Key: { reportId: `RATE#${action}#${window}#${identityHash}` },
    UpdateExpression: "SET #expiresAt = :expiresAt ADD #requestCount :one",
    ConditionExpression: "attribute_not_exists(#requestCount) OR #requestCount < :limit",
    ExpressionAttributeNames: {
      "#expiresAt": "expiresAt",
      "#requestCount": "requestCount",
    },
    ExpressionAttributeValues: {
      ":expiresAt": (window + 2) * WINDOW_SECONDS,
      ":one": 1,
      ":limit": limit,
    },
  });
}

export async function consumeRateLimit(client, options) {
  try {
    await client.send(createRateLimitCommand(options));
    return true;
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") return false;
    throw error;
  }
}
