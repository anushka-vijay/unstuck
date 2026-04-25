interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

interface GoogleTokenError {
  type?: string;
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

async function getCalendarAccessToken(
  clientId: string,
  scope: string,
  _prompt: string = "select_account"
): Promise<string> {
  const cached = readTokenCache();
  if (
    cached &&
    cached.expiresAtMs > Date.now() + 30_000 &&
    hasAllScopes(cached.scopes, scope)
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
        scope,
        callback: (resp: GoogleTokenResponse) => {
          if (resp.error) {
            reject(new Error(`Google OAuth failed: ${resp.error}`));
            return;
          }
          if (!resp.access_token) {
            reject(new Error("Google OAuth did not return an access token."));
            return;
          }
          const scopes = (resp.scope || scope).split(/\s+/).filter(Boolean);
          const expiresIn = resp.expires_in ?? 3600;
          writeTokenCache({
            accessToken: resp.access_token,
            expiresAtMs: Date.now() + Math.max(30, expiresIn - 30) * 1000,
            scopes,
          });
          resolve(resp.access_token);
        },
        error_callback: (err: GoogleTokenError) => {
          const type = err.type || "unknown";
          if (type === "popup_failed_to_open") {
            reject(
              new Error(
                "Google sign-in popup was blocked. Allow popups for localhost and try again."
              )
            );
            return;
          }
          if (type === "popup_closed") {
            reject(new Error("Google sign-in popup was closed before completion."));
            return;
          }
          reject(new Error(`Google OAuth failed: ${type}`));
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

function buildEventWindow() {
  const start = new Date();
  start.setSeconds(0, 0);
  const mins = start.getMinutes();
  const nextTen = Math.ceil(mins / 10) * 10;
  start.setMinutes(nextTen, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

export interface CalendarEventPreview {
  summary: string;
  start: Date;
  end: Date;
  dateLabel: string;
  timeRangeLabel: string;
}

function formatMonthDay(date: Date): string {
  const month = date.toLocaleString(undefined, { month: "long" });
  return `${month} ${date.getDate()}`;
}

function formatTime(date: Date): string {
  const h24 = date.getHours();
  const mins = date.getMinutes().toString().padStart(2, "0");
  const suffix = h24 >= 12 ? "pm" : "am";
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${hour12}.${mins}${suffix}`;
}

export function getCalendarEventPreview(taskText: string): CalendarEventPreview {
  const { start, end } = buildEventWindow();
  const summary = taskText.trim().slice(0, 120) || "Unstuck task";
  return {
    summary,
    start,
    end,
    dateLabel: formatMonthDay(start),
    timeRangeLabel: `${formatTime(start)} to ${formatTime(end)}`,
  };
}

export async function addTaskToGoogleCalendar(
  clientId: string,
  taskText: string
): Promise<void> {
  const accessToken = await getCalendarAccessToken(
    clientId,
    "https://www.googleapis.com/auth/calendar.events"
  );
  const preview = getCalendarEventPreview(taskText);

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        summary: preview.summary,
        description: "Created from The Unstuck Button.",
        start: {
          dateTime: preview.start.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: preview.end.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to create calendar event (${res.status}). ${body || ""}`.trim()
    );
  }
}

function asDateString(start?: { dateTime?: string; date?: string }): string {
  if (!start) return "unknown time";
  if (start.dateTime) return new Date(start.dateTime).toLocaleString();
  if (start.date) return `${start.date} (all day)`;
  return "unknown time";
}

export async function fetchCalendarContext(clientId: string): Promise<string> {
  const accessToken = await getCalendarAccessToken(
    clientId,
    "https://www.googleapis.com/auth/calendar.readonly"
  );
  const now = new Date();
  const until = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
    `?timeMin=${encodeURIComponent(now.toISOString())}` +
    `&timeMax=${encodeURIComponent(until.toISOString())}` +
    "&singleEvents=true&orderBy=startTime&maxResults=20";

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to read calendar (${res.status}). ${body || ""}`.trim()
    );
  }

  const data = (await res.json()) as {
    items?: Array<{
      summary?: string;
      description?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };
  const items = data.items || [];
  const deadlineRe = /\b(due|deadline|exam|submission|deliverable|final)\b/i;

  const deadlines = items
    .filter((e) => deadlineRe.test(`${e.summary || ""} ${e.description || ""}`))
    .slice(0, 5)
    .map((e) => `- ${e.summary || "Untitled"} @ ${asDateString(e.start)}`);

  const busy = items
    .slice(0, 8)
    .map(
      (e) =>
        `- ${asDateString(e.start)} to ${asDateString(e.end)}: ${
          e.summary || "busy"
        }`
    );

  return [
    "Calendar context (next 14 days):",
    deadlines.length ? "Likely deadlines:\n" + deadlines.join("\n") : "Likely deadlines:\n- none detected",
    "Busy windows:\n" + (busy.length ? busy.join("\n") : "- none"),
    "Avoid proposing actions that conflict with these windows or urgent deadlines.",
  ].join("\n\n");
}

