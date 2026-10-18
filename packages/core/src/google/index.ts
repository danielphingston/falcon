export * from "./http";
export * from "./drive";
export * from "./sync";
export * from "./calendar";

/** OAuth scopes the app asks for: its own hidden Drive folder, calendar events, and the account email. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
] as const;
