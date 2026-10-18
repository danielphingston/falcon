/** Returns a valid OAuth access token (refreshing or prompting as the host app sees fit). */
export type TokenGetter = () => Promise<string>;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** The token is missing, expired or lacks a scope: the user needs to reconnect. */
  get needsAuth() {
    return this.status === 401 || this.status === 403;
  }
}

/** fetch() with the bearer token, turning non-2xx responses into GoogleApiError. */
export async function gfetch(getToken: TokenGetter, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? detail;
    } catch {
      /* not JSON */
    }
    throw new GoogleApiError(res.status, `Google API ${res.status}: ${detail}`);
  }
  return res;
}
