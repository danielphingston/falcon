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

// ---------- Sign-in ----------
//
// Safari only allows a popup when it opens synchronously inside the tap, so
// everything the popup needs (Google's script, client ID, scopes, last email)
// is loaded ahead of time by warmGoogle(), and connectGoogle() opens it with
// no await in between. Safari and iOS can't complete the popup flow (see
// prefersRedirectSignIn), so there, or if a popup is blocked, we use a
// full-page redirect instead.

interface Prepared {
  gis: Gis | null;
  clientId: string;
  scopes: string[];
  email?: string;
}
let prepared: Prepared | null = null;
let warming: Promise<void> | null = null;

/** Loads what sign-in needs. Call on startup and whenever the client ID changes. */
export function warmGoogle(): Promise<void> {
  warming = (async () => {
    const clientId = await googleClientId();
    if (!clientId) {
      prepared = null;
      return;
    }
    const previous = await readAuth();
    const scopes = [...GOOGLE_SCOPES, GEMINI_OAUTH_SCOPE];
    prepared = { gis: null, clientId, scopes, email: previous?.email };
    try {
      prepared.gis = await loadGis();
    } catch {
      /* offline; redirect sign-in still works once back online */
    }
  })();
  return warming;
}

/**
 * Where Google's popup sign-in is unreliable: Safari on any device, every
 * browser on iPhone/iPad (all WebKit), and home-screen apps. There the popup
 * finishes consent but can't hand the token back (it spins forever after
 * "Continue"), so we use the redirect flow instead.
 */
export function prefersRedirectSignIn(): boolean {
  const ua = navigator.userAgent;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg\/|EdgiOS\/|OPR\//.test(ua);
  return standalone || ios || safari;
}

const redirectUri = () => `${location.origin}${import.meta.env.BASE_URL}`;
const REDIRECT_STATE = "fdd-oauth-state";

function startRedirectSignIn(p: Prepared) {
  const state = crypto.randomUUID();
  localStorage.setItem(REDIRECT_STATE, JSON.stringify({ state, back: location.pathname + location.search }));
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: redirectUri(),
    response_type: "token",
    scope: p.scopes.join(" "),
    include_granted_scopes: "true",
    state,
    ...(p.email ? { login_hint: p.email } : { prompt: "consent" }),
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}

/**
 * Starts Google sign-in. Call it directly from a tap/click handler, before any
 * other await. Resolves with the new sign-in, or null when the page is
 * navigating to Google (redirect flow; finishRedirectSignIn completes it).
 */
export function connectGoogle(): Promise<GoogleAuth | null> {
  const p = prepared;
  if (!p) {
    void warmGoogle();
    return Promise.reject(new Error(warming ? "Google sign-in is still loading. Tap again in a moment." : "Add your Google OAuth client ID first"));
  }
  if (!p.gis || prefersRedirectSignIn()) {
    startRedirectSignIn(p);
    return Promise.resolve(null);
  }
  return new Promise<GoogleAuth | null>((resolve, reject) => {
    const client = p.gis!.accounts.oauth2.initTokenClient({
      client_id: p.clientId,
      scope: p.scopes.join(" "),
      callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(saveToken(r, p.email))),
      error_callback: (e) => {
        if (e.type === "popup_failed_to_open") {
          // Blocked anyway (strict browser settings): use the redirect instead.
          startRedirectSignIn(p);
          resolve(null);
        } else reject(new Error(e.type === "popup_closed" ? "Sign-in window was closed" : e.message || e.type));
      },
    });
    // Synchronous with the user's tap; no await before this line.
    client.requestAccessToken(p.email ? { prompt: "", login_hint: p.email } : { prompt: "consent" });
  });
}

async function saveToken(r: TokenResponse, previousEmail?: string): Promise<GoogleAuth> {
  const accessToken = r.access_token!;
  let email = previousEmail;
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) email = ((await res.json()) as { email?: string }).email ?? email;
  } catch {
    /* email is cosmetic */
  }
  const auth: GoogleAuth = {
    accessToken,
    expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000,
    email,
    scope: r.scope ?? "",
  };
  await db.meta.put({ key: KEY, value: auth });
  if (prepared) prepared.email = email;
  return auth;
}

/**
 * Completes a redirect sign-in when Google sends the user back with the token
 * in the URL fragment. Returns the sign-in, an error message, or null if this
 * page load isn't a sign-in return. Removes the token from the address bar.
 */
export async function finishRedirectSignIn(): Promise<GoogleAuth | string | null> {
  if (!/[#&](access_token|error)=/.test(location.hash)) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const saved = JSON.parse(localStorage.getItem(REDIRECT_STATE) ?? "null") as { state: string; back: string } | null;
  localStorage.removeItem(REDIRECT_STATE);
  history.replaceState(null, "", saved?.back ?? location.pathname);
  if (!saved || params.get("state") !== saved.state) return "Sign-in didn't match a request from this app. Please try again.";
  if (params.get("error")) return params.get("error") === "access_denied" ? "Google sign-in was cancelled" : `Google sign-in failed: ${params.get("error")}`;
  const previous = await readAuth();
  return saveToken(
    { access_token: params.get("access_token") ?? undefined, expires_in: params.get("expires_in") ?? undefined, scope: params.get("scope") ?? "" },
    previous?.email,
  );
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
