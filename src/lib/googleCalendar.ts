interface GoogleTokenResponse {
  access_token: string;
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

async function getCalendarAccessToken(clientId: string): Promise<string> {
  await loadGoogleScript();
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new Error("Google OAuth client not available.");

  return new Promise<string>((resolve, reject) => {
    const tokenClient = oauth.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/calendar.events",
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
    tokenClient.requestAccessToken({ prompt: "select_account" });
  });
}

function buildEventWindow() {
  const start = new Date();
  start.setMinutes(start.getMinutes() + 5);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { start, end };
}

export async function addTaskToGoogleCalendar(
  clientId: string,
  taskText: string
): Promise<void> {
  const accessToken = await getCalendarAccessToken(clientId);
  const { start, end } = buildEventWindow();
  const summary = taskText.trim().slice(0, 120) || "Unstuck task";

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        summary,
        description: "Created from The Unstuck Button.",
        start: {
          dateTime: start.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: end.toISOString(),
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

