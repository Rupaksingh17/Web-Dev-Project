import { randomUUID } from "node:crypto";
import { consumeRateLimit } from "./rate-limit.mjs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const REPORTS_PER_HOUR_PER_USER = 10;
const PHOTO_PRESIGNS_PER_HOUR_PER_USER = 20;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_CATEGORIES = new Set([
  "Roads & potholes",
  "Street lighting",
  "Waste & litter",
  "Water & drainage",
  "Sidewalks & access",
  "Parks & public spaces",
  "Other",
]);
const ALLOWED_STATUSES = new Set(["REPORTED", "IN_PROGRESS", "RESOLVED"]);

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
const tableName = process.env.REPORTS_TABLE;
const bucketName = process.env.REPORTS_BUCKET;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
}

function authenticatedUserSub(event) {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== "string" || !sub) throw new HttpError(401, "Sign in before submitting a report.");
  return sub;
}

function parseBody(event) {
  if (!event.body) throw new HttpError(400, "Request body must be a JSON object.");
  const value = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  return parsed;
}

function requiredText(value, field, minLength, maxLength) {
  if (typeof value !== "string") throw new HttpError(400, `${field} is required.`);
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new HttpError(400, `${field} must be between ${minLength} and ${maxLength} characters.`);
  }
  return normalized;
}

async function enforceUserRateLimit(userSub, action, limit) {
  const allowed = await consumeRateLimit(documentClient, {
    tableName,
    principalId: userSub,
    action,
    limit,
  });
  if (!allowed) throw new HttpError(429, "Too many requests. Please try again later.");
}

function decodeNextToken(value) {
  if (!value) return undefined;
  try {
    const key = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!key || typeof key.reportId !== "string" || typeof key.createdAtReportId !== "string") {
      throw new Error("Invalid key");
    }
    return key;
  } catch {
    throw new HttpError(400, "The page token is invalid. Refresh the report list.");
  }
}

async function withPhotoUrl(report) {
  const { reporterSub: _privateReporterId, ...publicFields } = report;
  if (!publicFields.photoKey) return publicFields;
  const photoUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucketName, Key: publicFields.photoKey }),
    { expiresIn: 3600 },
  );
  return { ...publicFields, photoUrl };
}

async function listReports(event) {
  const params = event.queryStringParameters ?? {};
  const limit = Math.min(Math.max(Number.parseInt(params.limit ?? "24", 10) || 24, 1), 50);
  const filters = [];
  const names = { "#feed": "feedPartition" };
  const values = { ":public": "PUBLIC" };

  if (params.category) {
    if (!ALLOWED_CATEGORIES.has(params.category)) throw new HttpError(400, "Unknown issue category.");
    names["#category"] = "category";
    values[":category"] = params.category;
    filters.push("#category = :category");
  }
  if (params.status) {
    if (!ALLOWED_STATUSES.has(params.status)) throw new HttpError(400, "Unknown report status.");
    names["#status"] = "status";
    values[":status"] = params.status;
    filters.push("#status = :status");
  }

  const result = await documentClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: "FeedIndex",
    KeyConditionExpression: "#feed = :public",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ...(filters.length ? { FilterExpression: filters.join(" AND ") } : {}),
    ...(params.nextToken ? { ExclusiveStartKey: decodeNextToken(params.nextToken) } : {}),
    Limit: limit,
    ScanIndexForward: false,
  }));

  const items = await Promise.all((result.Items ?? []).map(withPhotoUrl));
  const nextToken = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
    : undefined;
  return response(200, { items, nextToken });
}

async function getReport(reportId) {
  const result = await documentClient.send(new GetCommand({
    TableName: tableName,
    Key: { reportId },
  }));
  if (!result.Item || result.Item.feedPartition !== "PUBLIC") {
    throw new HttpError(404, "That report could not be found.");
  }
  return response(200, await withPhotoUrl(result.Item));
}

async function createReport(event) {
  const body = parseBody(event);
  const reporterSub = authenticatedUserSub(event);
  const title = requiredText(body.title, "Title", 6, 100);
  const description = requiredText(body.description, "Description", 20, 1500);
  const locationLabel = requiredText(body.locationLabel, "Location", 3, 180);
  if (!ALLOWED_CATEGORIES.has(body.category)) throw new HttpError(400, "Choose a valid issue category.");

  const coordinatesProvided = body.latitude !== undefined || body.longitude !== undefined;
  if (coordinatesProvided && (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude))) {
    throw new HttpError(400, "Provide both valid location coordinates, or leave both blank.");
  }
  if (Number.isFinite(body.latitude) && (body.latitude < -90 || body.latitude > 90)) {
    throw new HttpError(400, "Latitude is outside the valid range.");
  }
  if (Number.isFinite(body.longitude) && (body.longitude < -180 || body.longitude > 180)) {
    throw new HttpError(400, "Longitude is outside the valid range.");
  }
  await enforceUserRateLimit(reporterSub, "report", REPORTS_PER_HOUR_PER_USER);

  let photoKey;
  if (body.photoKey !== undefined && body.photoKey !== null && body.photoKey !== "") {
    if (typeof body.photoKey !== "string" || !/^pending\/\d{4}\/[a-f0-9-]{36}\/[\w.-]{1,80}$/i.test(body.photoKey)) {
      throw new HttpError(400, "The uploaded photo reference is invalid.");
    }
    try {
      const photo = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: body.photoKey }));
      if (!photo.ContentLength || photo.ContentLength > MAX_PHOTO_BYTES || !ALLOWED_IMAGE_TYPES.has(photo.ContentType ?? "")) {
        throw new HttpError(400, "The uploaded photo must be a JPG, PNG, or WebP smaller than 5 MB.");
      }
      photoKey = body.photoKey;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "Upload the report photo again before submitting.");
    }
  }

  const now = new Date().toISOString();
  const reportId = randomUUID();
  const report = {
    reportId,
    feedPartition: "PUBLIC",
    createdAtReportId: `${now}#${reportId}`,
    title,
    description,
    category: body.category,
    locationLabel,
    ...(coordinatesProvided ? { latitude: body.latitude, longitude: body.longitude } : {}),
    status: "REPORTED",
    reporterSub,
    createdAt: now,
    updatedAt: now,
  };

  await documentClient.send(new PutCommand({
    TableName: tableName,
    Item: report,
    ConditionExpression: "attribute_not_exists(reportId)",
  }));

  let finalPhotoKey;
  if (photoKey) {
    const fileName = photoKey.split("/").at(-1);
    finalPhotoKey = `reports/${new Date().getUTCFullYear()}/${reportId}/${fileName}`;
    try {
      const encodedSource = photoKey.split("/").map(encodeURIComponent).join("/");
      await s3.send(new CopyObjectCommand({
        Bucket: bucketName,
        Key: finalPhotoKey,
        CopySource: `${bucketName}/${encodedSource}`,
      }));
      const updated = await documentClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { reportId },
        UpdateExpression: "SET photoKey = :photoKey",
        ExpressionAttributeValues: { ":photoKey": finalPhotoKey },
        ReturnValues: "ALL_NEW",
      }));
      Object.assign(report, updated.Attributes);
    } catch (error) {
      const cleanup = await Promise.allSettled([
        documentClient.send(new DeleteCommand({ TableName: tableName, Key: { reportId } })),
        ...(finalPhotoKey ? [s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: finalPhotoKey }))] : []),
      ]);
      cleanup.filter((result) => result.status === "rejected").forEach((result) => {
        console.error("Report creation cleanup failed", result.reason);
      });
      throw error;
    }
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: photoKey }));
    } catch (error) {
      console.warn("Temporary photo cleanup deferred to the bucket lifecycle rule", error);
    }
  }

  return response(201, await withPhotoUrl(report));
}

async function presignPhoto(event) {
  const body = parseBody(event);
  const userSub = authenticatedUserSub(event);
  const fileName = requiredText(body.fileName, "File name", 1, 180);
  const contentType = body.contentType;
  const size = Number(body.size);
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new HttpError(400, "Use a JPG, PNG, or WebP photo.");
  if (!Number.isInteger(size) || size < 1 || size > MAX_PHOTO_BYTES) {
    throw new HttpError(400, "Photo must be smaller than 5 MB.");
  }
  await enforceUserRateLimit(userSub, "photo", PHOTO_PRESIGNS_PER_HOUR_PER_USER);

  const safeName = fileName.normalize("NFKD").replace(/[^\w.-]+/g, "-").slice(0, 80) || "photo";
  const key = `pending/${new Date().getUTCFullYear()}/${randomUUID()}/${safeName}`;
  const upload = await createPresignedPost(s3, {
    Bucket: bucketName,
    Key: key,
    Expires: 300,
    Fields: { "Content-Type": contentType },
    Conditions: [
      ["content-length-range", 1, MAX_PHOTO_BYTES],
      ["eq", "$Content-Type", contentType],
    ],
  });
  return response(200, { ...upload, key });
}

async function updateReport(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
  const groups = String(claims["cognito:groups"] ?? "").split(",");
  if (!groups.includes("admins")) throw new HttpError(403, "Administrator access is required.");

  const reportId = event.pathParameters?.reportId;
  if (!reportId) throw new HttpError(400, "Report ID is required.");
  const body = parseBody(event);
  if (!ALLOWED_STATUSES.has(body.status)) throw new HttpError(400, "Choose a valid report status.");
  const now = new Date().toISOString();
  try {
    const result = await documentClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { reportId },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(reportId)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": body.status, ":updatedAt": now },
      ReturnValues: "ALL_NEW",
    }));
    return response(200, await withPhotoUrl(result.Attributes));
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") throw new HttpError(404, "That report could not be found.");
    throw error;
  }
}

export async function handler(event) {
  if (!tableName || !bucketName) {
    console.error("Required REPORTS_TABLE or REPORTS_BUCKET configuration is missing.");
    return response(503, { message: "The report service is not configured yet." });
  }
  try {
    switch (event.routeKey) {
      case "GET /reports": return await listReports(event);
      case "GET /reports/{reportId}": return await getReport(event.pathParameters?.reportId);
      case "POST /reports": return await createReport(event);
      case "POST /uploads/presign": return await presignPhoto(event);
      case "PATCH /reports/{reportId}": return await updateReport(event);
      default: return response(404, { message: "Route not found." });
    }
  } catch (error) {
    if (error instanceof HttpError) return response(error.statusCode, { message: error.message });
    console.error("Unhandled API error", error);
    return response(500, { message: "Something went wrong. Please try again." });
  }
}
