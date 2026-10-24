import { gfetch, type TokenGetter } from "./http";

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/** A single JSON file the sync algorithm reads and writes. */
export interface RemoteFile {
  /** Contents (or null if the file doesn't exist yet) and an opaque version. */
  read(): Promise<{ content: unknown | null; version: string | null }>;
  /** Current version without downloading; null if the file doesn't exist. */
  version(): Promise<string | null>;
  write(content: unknown): Promise<{ version: string }>;
}

/**
 * A JSON file in the user's hidden Drive appDataFolder. Only this app's OAuth
 * client can see it, and it never shows up in the user's Drive.
 */
// The file keeps the app's old name so existing devices and backups still sync.
export function driveAppDataFile(getToken: TokenGetter, name = "fdd-tracker.json"): RemoteFile {
  let fileId: string | undefined;

  async function find(): Promise<{ id: string; version: string } | null> {
    const q = encodeURIComponent(`name='${name}' and trashed=false`);
    const res = await gfetch(getToken, `${API}?spaces=appDataFolder&q=${q}&fields=files(id,version)&orderBy=modifiedTime desc&pageSize=10`);
    const { files } = (await res.json()) as { files: { id: string; version: string }[] };
    const f = files[0] ?? null;
    fileId = f?.id;
    return f;
  }

  return {
    async version() {
      return (await find())?.version ?? null;
    },

    async read() {
      const f = await find();
      if (!f) return { content: null, version: null };
      const res = await gfetch(getToken, `${API}/${f.id}?alt=media`);
      return { content: await res.json(), version: f.version };
    },

    async write(content) {
      const body = JSON.stringify(content);
      if (!fileId) await find();
      if (fileId) {
        const res = await gfetch(getToken, `${UPLOAD}/${fileId}?uploadType=media&fields=id,version`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
        });
        return { version: ((await res.json()) as { version: string }).version };
      }
      const boundary = `falcon${Math.random().toString(36).slice(2)}`;
      const meta = JSON.stringify({ name, parents: ["appDataFolder"], mimeType: "application/json" });
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
      const res = await gfetch(getToken, `${UPLOAD}?uploadType=multipart&fields=id,version`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      const created = (await res.json()) as { id: string; version: string };
      fileId = created.id;
      return { version: created.version };
    },
  };
}
