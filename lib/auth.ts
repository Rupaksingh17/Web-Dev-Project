import {
  COGNITO_CLIENT_ID,
  COGNITO_DOMAIN,
  COGNITO_REDIRECT_URI,
  COGNITO_READY,
} from "@/lib/config";

export type LoginRole = "customer" | "admin";
export type CustomerLoginMode = "login" | "signup";

const ADMIN_TOKEN_KEY = "civic-signal-admin-token";
const CUSTOMER_TOKEN_KEY = "civic-signal-customer-token";
const OAUTH_PENDING_PREFIX = "civic-signal-oauth-pending:";

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function tokenClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isAdminAccessToken(token: string) {
  const groups = tokenClaims(token)?.["cognito:groups"];
  return Array.isArray(groups) && groups.includes("admins");
}

function getStoredToken(key: string) {
  if (typeof window === "undefined") return "";
  try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; }
}

export function hasAdminSetup() { return COGNITO_READY; }
export function getAdminToken() {
  const token = getStoredToken(ADMIN_TOKEN_KEY);
  return token && isAdminAccessToken(token) ? token : "";
}
export function getCustomerToken() {
  const token = getStoredToken(CUSTOMER_TOKEN_KEY);
  return token && !isAdminAccessToken(token) ? token : "";
}

export function clearAdminToken() {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* Storage may be restricted. */ }
}
export function clearCustomerToken() {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(CUSTOMER_TOKEN_KEY); } catch { /* Storage may be restricted. */ }
}

async function beginLogin(role: LoginRole, mode: CustomerLoginMode = "login") {
  if (!COGNITO_READY) throw new Error("Secure sign-in has not been configured yet.");
  const state = randomToken();
  const verifier = randomToken(48);
  const challenge = await challengeFor(verifier);
  try {
    // Key each PKCE transaction by its random state so simultaneous sign-ins
    // in the same tab cannot overwrite one another's verifier or role.
    sessionStorage.setItem(`${OAUTH_PENDING_PREFIX}${state}`, JSON.stringify({ verifier, role }));
  } catch {
    throw new Error("Your browser blocked secure sign-in storage. Enable site storage and try again.");
  }

  const query = new URLSearchParams({
    client_id: COGNITO_CLIENT_ID,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: COGNITO_REDIRECT_URI,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  const endpoint = role === "customer" && mode === "signup" ? "/signup" : "/oauth2/authorize";
  window.location.assign(`${COGNITO_DOMAIN}${endpoint}?${query.toString()}`);
}

export async function beginAdminLogin() { return beginLogin("admin"); }
export async function beginCustomerLogin(mode: CustomerLoginMode = "login") { return beginLogin("customer", mode); }

export async function completeLogin(code: string, state: string): Promise<LoginRole> {
  let pending: { verifier?: string; role?: string } | null;
  try {
    const key = `${OAUTH_PENDING_PREFIX}${state}`;
    const stored = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    pending = stored ? JSON.parse(stored) as { verifier?: string; role?: string } : null;
  } catch {
    throw new Error("Your browser could not read the sign-in session. Restart sign-in and try again.");
  }
  const verifier = pending?.verifier;
  const requestedRole = pending?.role;
  if (!verifier || (requestedRole !== "admin" && requestedRole !== "customer")) {
    throw new Error("The sign-in session expired. Please try again.");
  }

  let response: Response;
  try {
    response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: COGNITO_CLIENT_ID,
        code,
        redirect_uri: COGNITO_REDIRECT_URI,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not reach the sign-in service. Check your connection and try again.");
  }

  let result: { access_token?: string; error_description?: string };
  try { result = await response.json() as { access_token?: string; error_description?: string }; }
  catch { throw new Error("The sign-in service returned an unreadable response. Try again."); }
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description ?? "Could not complete sign-in.");
  }

  const isAdmin = isAdminAccessToken(result.access_token);
  if (requestedRole === "admin" && !isAdmin) {
    throw new Error("This account does not have administrator access. Sign in with an administrator account.");
  }
  const role: LoginRole = isAdmin ? "admin" : "customer";
  try {
    sessionStorage.setItem(role === "admin" ? ADMIN_TOKEN_KEY : CUSTOMER_TOKEN_KEY, result.access_token);
    sessionStorage.removeItem(role === "admin" ? CUSTOMER_TOKEN_KEY : ADMIN_TOKEN_KEY);
  } catch {
    throw new Error("Sign-in succeeded, but your browser could not save the session. Enable site storage and try again.");
  }
  return role;
}

function signOutRole(role: LoginRole) {
  if (typeof window === "undefined") return;
  if (role === "admin") clearAdminToken();
  else clearCustomerToken();
  if (COGNITO_READY) {
    const query = new URLSearchParams({ client_id: COGNITO_CLIENT_ID, logout_uri: window.location.origin + "/" });
    window.location.assign(`${COGNITO_DOMAIN}/logout?${query.toString()}`);
  } else window.location.assign("/");
}

export function signOutCustomer() { signOutRole("customer"); }
export function signOutAdmin() { signOutRole("admin"); }
