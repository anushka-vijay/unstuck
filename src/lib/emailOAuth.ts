export interface InboxPreviewItem {
  from: string;
  subject: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

interface GoogleTokenError {
  type?: string;
}

interface GoogleUserInfo {
  email?: string;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: GoogleTokenResponse) => void;
            error_callback?: (err: GoogleTokenError) => void;
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        };
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;
const GOOGLE_OAUTH_TOKEN_CACHE_KEY = "GOOGLE_OAUTH_TOKEN_CACHE";

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
  scopes: string[];
}

function readTokenCache(): TokenCache | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(GOOGLE_OAUTH_TOKEN_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TokenCache;
    if (
      !parsed ||
      typeof parsed.accessToken !== "string" ||
      typeof parsed.expiresAtMs !== "number" ||
      !Array.isArray(parsed.scopes)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeTokenCache(cache: TokenCache): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GOOGLE_OAUTH_TOKEN_CACHE_KEY, JSON.stringify(cache));
}

function hasAllScopes(granted: string[], requiredScopeString: string): boolean {
  const required = requiredScopeString.split(/\s+/).filter(Boolean);
  return required.every((s) => granted.includes(s));
}

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Google OAuth script.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google OAuth script."));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

async function getGoogleAccessToken(clientId: string): Promise<string> {
  const requiredScopes =
    "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events";
  const cached = readTokenCache();
  if (
    cached &&
    cached.expiresAtMs > Date.now() + 30_000 &&
    hasAllScopes(cached.scopes, requiredScopes)
  ) {
    return cached.accessToken;
  }

  await loadGoogleScript();
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new Error("Google OAuth client not available.");

  const requestToken = (prompt: string) =>
    new Promise<string>((resolve, reject) => {
      const tokenClient = oauth.initTokenClient({
        client_id: clientId,
        scope: requiredScopes,
        callback: (resp: GoogleTokenResponse) => {
          if (resp.error) {
            reject(new Error(`Google OAuth failed: ${resp.error}`));
            return;
          }
          if (!resp.access_token) {
            reject(new Error("Google OAuth did not return an access token."));
            return;
          }
          const scopes = (resp.scope || requiredScopes).split(/\s+/).filter(Boolean);
          const expiresIn = resp.expires_in ?? 3600;
          writeTokenCache({
            accessToken: resp.access_token,
            expiresAtMs: Date.now() + Math.max(30, expiresIn - 30) * 1000,
            scopes,
          });
          resolve(resp.access_token);
        },
        error_callback: (err: GoogleTokenError) => {
          const errType = err.type || "unknown";
          if (errType === "popup_failed_to_open") {
            reject(
              new Error(
                "Google sign-in popup was blocked. Allow popups for localhost:5173 and try again."
              )
            );
            return;
          }
          if (errType === "popup_closed") {
            reject(new Error("Google sign-in popup was closed before completion."));
            return;
          }
          reject(new Error(`Google OAuth failed: ${errType}`));
        },
      });
      tokenClient.requestAccessToken({ prompt });
    });

  try {
    return await requestToken("");
  } catch {
    return requestToken("consent");
  }
}

async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Google profile.");
  const data = (await res.json()) as GoogleUserInfo;
  if (!data.email) throw new Error("Google profile did not include an email.");
  return data.email;
}

function getHeaderValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  key: string
): string {
  if (!headers) return "";
  const value = headers.find(
    (h) => (h.name || "").toLowerCase() === key.toLowerCase()
  )?.value;
  return value || "";
}

async function fetchGmailPreview(accessToken: string): Promise<InboxPreviewItem[]> {
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=in:inbox",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!listRes.ok) {
    const body = await listRes.text();
    throw new Error(
      `Failed to fetch Gmail messages (${listRes.status}). ${body || "Check Gmail API + OAuth scopes."}`
    );
  }
  const listData = (await listRes.json()) as {
    messages?: Array<{ id?: string }>;
  };
  const ids = (listData.messages || [])
    .map((m) => m.id)
    .filter((id): id is string => !!id)
    .slice(0, 3);

  if (ids.length === 0) return [];

  const details = await Promise.all(
    ids.map(async (id) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!msgRes.ok) return null;
      const data = (await msgRes.json()) as {
        payload?: { headers?: Array<{ name?: string; value?: string }> };
      };
      const from = getHeaderValue(data.payload?.headers, "From") || "Unknown sender";
      const subject = getHeaderValue(data.payload?.headers, "Subject") || "(no subject)";
      return { from, subject };
    })
  );

  return details.filter((x): x is InboxPreviewItem => !!x);
}

export async function connectGoogleEmail(clientId: string): Promise<{
  email: string;
  inboxPreview: InboxPreviewItem[];
}> {
  const accessToken = await getGoogleAccessToken(clientId);
  const email = await fetchGoogleEmail(accessToken);
  let inboxPreview: InboxPreviewItem[] = [];
  try {
    inboxPreview = await fetchGmailPreview(accessToken);
  } catch (err) {
    console.warn("Gmail preview fetch failed; continuing with connected account.", err);
  }
  return { email, inboxPreview };
}
