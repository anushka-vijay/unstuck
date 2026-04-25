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

interface EventInterval {
  start: Date;
  end: Date;
  summary: string;
  description: string;
}

function toEventInterval(item: {
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}): EventInterval | null {
  let start: Date | null = null;
  let end: Date | null = null;
  if (item.start?.dateTime) start = new Date(item.start.dateTime);
  else if (item.start?.date) start = new Date(`${item.start.date}T00:00:00`);
  if (item.end?.dateTime) end = new Date(item.end.dateTime);
  else if (item.end?.date) end = new Date(`${item.end.date}T00:00:00`);
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return null;
  if (end <= start) return null;
  return {
    start,
    end,
    summary: item.summary || "",
    description: item.description || "",
  };
}

function overlapsAny(start: Date, end: Date, events: EventInterval[]): boolean {
  // Conflict = any overlap at all.
  return events.some((e) => start < e.end && end > e.start);
}

function roundUpToTenMinutes(d: Date): Date {
  const x = new Date(d);
  x.setSeconds(0, 0);
  const nextTen = Math.ceil(x.getMinutes() / 10) * 10;
  x.setMinutes(nextTen, 0, 0);
  return x;
}

function inferTaskDeadline(taskText: string, events: EventInterval[]): Date | null {
  const deadlineRe = /\b(due|deadline|exam|submission|deliverable|final)\b/i;
  const keywords = taskText
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((w) => w.length >= 4)
    .slice(0, 6);
  if (!keywords.length) return null;
  const now = new Date();
  const candidates = events
    .filter((e) => e.start > now)
    .filter((e) => deadlineRe.test(`${e.summary} ${e.description}`))
    .filter((e) => {
      const text = `${e.summary} ${e.description}`.toLowerCase();
      return keywords.some((k) => text.includes(k));
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  return candidates[0]?.start || null;
}

async function fetchEventIntervals(
  accessToken: string,
  timeMin: Date,
  timeMax: Date
): Promise<EventInterval[]> {
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
    `?timeMin=${encodeURIComponent(timeMin.toISOString())}` +
    `&timeMax=${encodeURIComponent(timeMax.toISOString())}` +
    "&singleEvents=true&orderBy=startTime&maxResults=250";
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
  return (data.items || [])
    .map(toEventInterval)
    .filter((x): x is EventInterval => !!x);
}

function findAvailableSlot(
  events: EventInterval[],
  now: Date,
  durationMs: number,
  latestEndExclusive?: Date
): { start: Date; end: Date } | null {
  let candidate = roundUpToTenMinutes(new Date(now.getTime() + 10 * 60 * 1000));
  const horizon = latestEndExclusive
    ? new Date(latestEndExclusive)
    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  while (candidate < horizon) {
    const end = new Date(candidate.getTime() + durationMs);
    if (latestEndExclusive && end > latestEndExclusive) break;
    if (!overlapsAny(candidate, end, events)) return { start: candidate, end };
    candidate = new Date(candidate.getTime() + 10 * 60 * 1000);
  }
  return null;
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

function toPreview(summary: string, start: Date, end: Date): CalendarEventPreview {
  return {
    summary,
    start,
    end,
    dateLabel: formatMonthDay(start),
    timeRangeLabel: `${formatTime(start)} to ${formatTime(end)}`,
  };
}

async function planTaskSlot(
  accessToken: string,
  taskText: string
): Promise<{ summary: string; start: Date; end: Date }> {
  const now = new Date();
  const searchStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const searchMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const events = (await fetchEventIntervals(accessToken, searchStart, searchMax)).filter(
    (e) => e.end > now
  );
  const summary = taskText.trim().slice(0, 120) || "Unstuck task";
  const durationMs = 60 * 60 * 1000;
  const deadline = inferTaskDeadline(summary, events);
  const slot =
    findAvailableSlot(
      events,
      now,
      durationMs,
      deadline ? new Date(deadline.getTime() - durationMs) : undefined
    ) ||
    findAvailableSlot(events, now, durationMs) || {
      start: buildEventWindow().start,
      end: buildEventWindow().end,
    };
  return { summary, start: slot.start, end: slot.end };
}

export async function getCalendarEventPreview(
  clientId: string,
  taskText: string
): Promise<CalendarEventPreview> {
  try {
    const accessToken = await getCalendarAccessToken(
      clientId,
      "https://www.googleapis.com/auth/calendar.readonly"
    );
    const planned = await planTaskSlot(accessToken, taskText);
    return toPreview(planned.summary, planned.start, planned.end);
  } catch {
    const { start, end } = buildEventWindow();
    const summary = taskText.trim().slice(0, 120) || "Unstuck task";
    return toPreview(summary, start, end);
  }
}

export async function addTaskToGoogleCalendar(
  clientId: string,
  taskText: string
): Promise<void> {
  const accessToken = await getCalendarAccessToken(
    clientId,
    "https://www.googleapis.com/auth/calendar.events"
  );
  const planned = await planTaskSlot(accessToken, taskText);

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        summary: planned.summary,
        description: "Created from The Unstuck Button.",
        start: {
          dateTime: planned.start.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: planned.end.toISOString(),
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

