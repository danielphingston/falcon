/**
 * Google sign-in with Google Identity Services (token model). Runs entirely in
 * the browser: access tokens last ~1 hour, there are no refresh tokens, so when
 * one expires the user taps "Reconnect" (a popup needs a user gesture).
 */
import { GEMINI_OAUTH_SCOPE, GOOGLE_SCOPES } from "@fdd/core";
import { db, getSettings } from "../db";

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(override?: { prompt?: string; login_hint?: string }): void;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type: string; message?: string }) => void;
        login_hint?: string;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}
declare global {
  interface Window {
    google?: Gis;
  }
}

export interface GoogleAuth {
  accessToken: string;
  expiresAt: number;
  email?: string;
  scope: string;
}

const KEY = "googleAuth";
export class NeedsAuthError extends Error {
  constructor() {
    super("Reconnect Google to sync");
  }
}

export async function googleClientId(): Promise<string> {
  return (await getSettings()).googleClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
}

export const readAuth = async () => ((await db.meta.get(KEY))?.value as GoogleAuth | undefined) ?? null;
export const hasScope = (auth: GoogleAuth | null, scope: string) => !!auth?.scope.split(" ").includes(scope);

let gisLoading: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error("Google sign-in failed to load")));
    s.onerror = () => {
      gisLoading = null;
      reject(new Error("Couldn't reach Google. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** Opens Google's consent popup. Must be called from a click. */
export async function connectGoogle(): Promise<GoogleAuth> {
  const clientId = await googleClientId();
  if (!clientId) throw new Error("Add your Google OAuth client ID first");
  const gis = await loadGis();
  const previous = await readAuth();
  // Gemini access is only requested when the assistant is set to use the Google sign-in.
  const scopes = (await getSettings()).geminiAuth === "google" ? [...GOOGLE_SCOPES, GEMINI_OAUTH_SCOPE] : [...GOOGLE_SCOPES];
  const response = await new Promise<TokenResponse>((resolve, reject) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(" "),
      callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r)),
      error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "Sign-in window was closed" : e.message || e.type)),
    });
    client.requestAccessToken(previous?.email ? { prompt: "", login_hint: previous.email } : { prompt: "consent" });
  });
  const accessToken = response.access_token!;
  let email = previous?.email;
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) email = ((await res.json()) as { email?: string }).email ?? email;
  } catch {
    /* email is cosmetic */
  }
  const auth: GoogleAuth = {
    accessToken,
    expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000,
    email,
    scope: response.scope ?? "",
  };
  await db.meta.put({ key: KEY, value: auth });
  return auth;
}

/** A still-valid token, or NeedsAuthError. Never opens a popup, so it's safe for background sync. */
export async function getAccessToken(): Promise<string> {
  const auth = await readAuth();
  if (!auth || auth.expiresAt - Date.now() < 60_000) throw new NeedsAuthError();
  return auth.accessToken;
}

/** Signs out: revokes the token with Google and forgets it. Local data stays. */
export async function disconnectGoogle() {
  const auth = await readAuth();
  await db.meta.delete(KEY);
  if (auth) {
    try {
      (await loadGis()).accounts.oauth2.revoke(auth.accessToken);
    } catch {
      /* already offline; the token expires within the hour anyway */
    }
  }
}
