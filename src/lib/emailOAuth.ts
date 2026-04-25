export interface InboxPreviewItem {
  from: string;
  subject: string;
}

interface GoogleTokenResponse {
  access_token: string;
  error?: string;
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
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        };
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

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
  await loadGoogleScript();
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new Error("Google OAuth client not available.");

  return new Promise<string>((resolve, reject) => {
    const tokenClient = oauth.initTokenClient({
      client_id: clientId,
      scope:
        "openid email profile https://www.googleapis.com/auth/gmail.readonly",
      callback: (resp: GoogleTokenResponse) => {
        if (resp.error) {
          reject(new Error(`Google OAuth failed: ${resp.error}`));
          return;
        }
        if (!resp.access_token) {
          reject(new Error("Google OAuth did not return an access token."));
          return;
        }
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
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
  if (!listRes.ok) throw new Error("Failed to fetch Gmail messages.");
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
  const [email, inboxPreview] = await Promise.all([
    fetchGoogleEmail(accessToken),
    fetchGmailPreview(accessToken),
  ]);
  return { email, inboxPreview };
}
