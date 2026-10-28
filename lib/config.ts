const trimEnd = (value: string) => value.replace(/\/+$/, "");

export const API_BASE_URL = trimEnd(process.env.NEXT_PUBLIC_API_BASE_URL ?? "");

export const COGNITO_DOMAIN = trimEnd(process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? "");
export const COGNITO_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";
export const COGNITO_REDIRECT_URI = process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI ?? "";
export const COGNITO_READY = Boolean(COGNITO_DOMAIN && COGNITO_CLIENT_ID && COGNITO_REDIRECT_URI);
