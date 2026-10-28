import { API_BASE_URL } from "@/lib/config";
import { getAdminToken, getCustomerToken } from "@/lib/auth";
import { CATEGORIES, type Category, type NewReport, type Report, type ReportPage, type ReportStatus } from "@/lib/types";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = "ApiError";
  }
}

async function readPayload<T>(response: Response): Promise<T | { message?: string }> {
  try {
    return await response.json() as T;
  } catch {
    throw new ApiError(`The server returned an unreadable response (${response.status}).`, response.status);
  }
}

async function request<T>(path: string, options: RequestInit = {}, token = ""): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError("The AWS API is not configured. Set NEXT_PUBLIC_API_BASE_URL and restart the app.");
  }

  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError("The request took too long. Check your connection and try again.");
    }
    throw new ApiError("Could not reach the CivicSignal service. Check your connection and try again.");
  }

  const payload = await readPayload<T>(response);
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "message" in payload
      ? String(payload.message || "")
      : "";
    if (response.status === 401) throw new ApiError("Your sign-in session expired. Sign in again.", 401);
    if (response.status === 403) throw new ApiError("Your account is not allowed to update reports.", 403);
    if (response.status === 429) throw new ApiError("Too many requests. Please wait before trying again.", 429);
    throw new ApiError(message || `The request failed (${response.status}).`, response.status);
  }
  return payload as T;
}

export type ReportFilters = { category?: string; status?: string; nextToken?: string };

export async function listReports(filters: ReportFilters = {}): Promise<ReportPage> {
  const query = new URLSearchParams();
  if (filters.category) query.set("category", filters.category);
  if (filters.status) query.set("status", filters.status);
  if (filters.nextToken) query.set("nextToken", filters.nextToken);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<ReportPage>(`/reports${suffix}`);
}

type PresignedPost = { url: string; fields: Record<string, string>; key: string };

async function uploadPhoto(photo: File, token: string): Promise<string> {
  if (photo.size < 1 || photo.size > MAX_PHOTO_BYTES) throw new ApiError("Choose a photo between 1 byte and 5 MB.");
  if (!ACCEPTED_PHOTO_TYPES.has(photo.type)) throw new ApiError("Use a JPG, PNG, or WebP photo.");

  const upload = await request<PresignedPost>("/uploads/presign", {
    method: "POST",
    body: JSON.stringify({ fileName: photo.name, contentType: photo.type, size: photo.size }),
  }, token);
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", photo);

  let response: Response;
  try {
    response = await fetch(upload.url, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ApiError("The photo upload did not complete. Try again with a smaller image.");
  }
  if (!response.ok) throw new ApiError(`Photo upload failed (${response.status}). Choose the file again and retry.`, response.status);
  return upload.key;
}

export async function createReport(input: NewReport, photo?: File): Promise<Report> {
  const token = getCustomerToken();
  if (!token) throw new ApiError("Sign in with a community account before submitting a report.", 401);
  const photoKey = photo ? await uploadPhoto(photo, token) : undefined;
  return request<Report>("/reports", {
    method: "POST",
    body: JSON.stringify({ ...input, photoKey }),
  }, token);
}

export async function updateReportStatus(reportId: string, status: ReportStatus): Promise<Report> {
  const token = getAdminToken();
  if (!token) throw new ApiError("Sign in as an administrator before changing report status.", 401);
  return request<Report>(`/reports/${encodeURIComponent(reportId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  }, token);
}

export function isKnownCategory(value: string): value is Category {
  return CATEGORIES.includes(value as Category);
}
