import { useEffect, useMemo, useRef, useState } from "react";
import {
  extractTasks,
  getUnstickAction,
  hasApiKey,
  type Energy,
  type Minutes,
  type UnstickResult,
} from "./lib/claude";
import {
  connectGoogleEmail,
  type InboxPreviewItem,
} from "./lib/emailOAuth";
import { addTaskToGoogleCalendar } from "./lib/googleCalendar";

type Step = "dump" | "tasks" | "setup" | "action";
type EmailProvider = "gmail" | "outlook";

interface EmailConnection {
  provider: EmailProvider;
  email: string;
  connectedAt: string;
  inboxPreview: InboxPreviewItem[];
}

const ESCAPE_TASK = "something else entirely";
const EMAIL_CONNECTION_KEY = "EMAIL_OAUTH_CONNECTION";

function readEmailConnection(): EmailConnection | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(EMAIL_CONNECTION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EmailConnection>;
    if (
      !parsed ||
      (parsed.provider !== "gmail" && parsed.provider !== "outlook") ||
      typeof parsed.email !== "string" ||
      typeof parsed.connectedAt !== "string" ||
      !Array.isArray(parsed.inboxPreview)
    ) {
      return null;
    }
    return {
      provider: parsed.provider,
      email: parsed.email,
      connectedAt: parsed.connectedAt,
      inboxPreview: parsed.inboxPreview as InboxPreviewItem[],
    };
  } catch {
    return null;
  }
}

export default function App() {
  const [step, setStep] = useState<Step>("dump");

  const [dump, setDump] = useState("");
  const [tasks, setTasks] = useState<string[]>([]);
  const [task, setTask] = useState<string>("");
  const [energy, setEnergy] = useState<Energy | null>(null);
  const [minutes, setMinutes] = useState<Minutes | null>(null);
  const [result, setResult] = useState<UnstickResult | null>(null);

  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiReady, setApiReady] = useState(hasApiKey());
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(
    readEmailConnection()
  );

  const stepIndex: Record<Step, number> = {
    dump: 0,
    tasks: 1,
    setup: 2,
    action: 3,
  };

  async function onExtractTasks() {
    if (!dump.trim()) return;
    setLoadingTasks(true);
    setStep("tasks");
    try {
      const list = await extractTasks(dump.trim());
      const withEscape = [...list];
      if (!withEscape.includes(ESCAPE_TASK)) withEscape.push(ESCAPE_TASK);
      setTasks(withEscape);
    } finally {
      setLoadingTasks(false);
    }
  }

  function onPickTask(t: string) {
    setTask(t);
    setStep("setup");
  }

  async function onGetUnstuck() {
    if (!task || !energy || !minutes) return;
    setLoadingAction(true);
    setStep("action");
    try {
      const r = await getUnstickAction({
        dump: dump.trim(),
        task,
        energy,
        minutes,
      });
      setResult(r);
    } finally {
      setLoadingAction(false);
    }
  }

  function reset() {
    setStep("dump");
    setDump("");
    setTasks([]);
    setTask("");
    setEnergy(null);
    setMinutes(null);
    setResult(null);
  }

  return (
    <div className="min-h-full flex flex-col">
      <Header
        apiReady={apiReady}
        emailConnection={emailConnection}
        onConfigureKey={() => setShowKeyModal(true)}
        onConfigureEmail={() => setShowEmailModal(true)}
      />

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 pb-24">
        <ProgressDots current={stepIndex[step]} />

        <div key={step} className="anim-in">
          {step === "dump" && (
            <DumpStep
              dump={dump}
              onChange={setDump}
              onNext={onExtractTasks}
            />
          )}
          {step === "tasks" && (
            <TasksStep
              loading={loadingTasks}
              tasks={tasks}
              onPick={onPickTask}
              onBack={() => setStep("dump")}
            />
          )}
          {step === "setup" && (
            <SetupStep
              task={task}
              energy={energy}
              minutes={minutes}
              setEnergy={setEnergy}
              setMinutes={setMinutes}
              onBack={() => setStep("tasks")}
              onGo={onGetUnstuck}
            />
          )}
          {step === "action" && (
            <ActionStep
              loading={loadingAction}
              result={result}
              task={task}
              onReset={reset}
            />
          )}
        </div>
      </main>

      <Footer />

      {showKeyModal && (
        <KeyModal
          onClose={() => {
            setShowKeyModal(false);
            setApiReady(hasApiKey());
          }}
        />
      )}
      {showEmailModal && (
        <EmailModal
          connection={emailConnection}
          onClose={() => setShowEmailModal(false)}
          onConnect={(next) => setEmailConnection(next)}
          onDisconnect={() => setEmailConnection(null)}
        />
      )}
    </div>
  );
}

function Header({
  apiReady,
  emailConnection,
  onConfigureKey,
  onConfigureEmail,
}: {
  apiReady: boolean;
  emailConnection: EmailConnection | null;
  onConfigureKey: () => void;
  onConfigureEmail: () => void;
}) {
  // Extract "anushka.vijay" from "anushka.vijay@gmail.com"
  const username = useMemo(() => {
    if (!emailConnection?.email) return null;
    return emailConnection.email.split("@")[0];
  }, [emailConnection]);

  return (
    <header className="w-full max-w-2xl mx-auto px-5 pt-8 pb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-rust border-[3px] border-ink rounded-full shadow-soft" />
        <div>
          <div className="font-display text-2xl font-semibold leading-none">
            The Unstuck Button
          </div>
          <div className="text-xs text-ink/60 mt-1 tracking-wide uppercase font-mono">
            one step. right now.
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <button
          onClick={onConfigureEmail}
          className={`text-xs font-mono px-3 py-2 border-2 transition-all flex items-center gap-2 rounded-full ${
            username 
              ? "border-ink bg-paper shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" 
              : "border-ink/20 hover:border-ink"
          }`}
          title="Manage Email Connection"
        >
          {/* Use a "User" or "Login" icon style */}
          <span className="text-sm">{username ? "👤" : "🔑"}</span>
          <span>{username ? username : "login"}</span>
        </button>

        <button
          onClick={onConfigureKey}
          className="text-xs font-mono px-3 py-2 border-2 border-ink/20 hover:border-ink rounded-full transition-colors"
          title="API Status"
        >
          {apiReady ? "● live" : "○ demo"}
        </button>
      </div>
    </header>
  );
}

function ProgressDots({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-3 py-6">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={
            "h-3 rounded-full border-2 border-ink transition-all duration-300 " +
            (i === current
              ? "w-10 bg-rust"
              : i < current
              ? "w-3 bg-ink"
              : "w-3 bg-paper")
          }
        />
      ))}
    </div>
  );
}

function DumpStep({
  dump,
  onChange,
  onNext,
}: {
  dump: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const canGo = dump.trim().length >= 3;
  return (
    <section>
      <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-[1.05] mb-3">
        What's swirling?
      </h1>
      <p className="text-ink/70 mb-6">
        Dump it here. Messy is fine — actually preferred.
      </p>

      <div className="card p-1 mb-5">
        <textarea
          ref={ref}
          value={dump}
          onChange={(e) => onChange(e.target.value)}
          placeholder="ugh i have to email my prof and the thing due friday and i haven't eaten and i don't know where to start"
          className="w-full h-48 sm:h-56 resize-none bg-cream p-5 font-body text-lg leading-relaxed focus:outline-none placeholder:text-ink/30"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canGo) {
              onNext();
            }
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-ink/50 font-mono">
          {dump.trim().length === 0
            ? "no wrong way to do this"
            : `${dump.trim().split(/\s+/).length} words of chaos`}
        </div>
        <button
          disabled={!canGo}
          onClick={onNext}
          className="press-btn bg-ink text-paper font-semibold px-6 py-3"
        >
          show me what's in here →
        </button>
      </div>
    </section>
  );
}

function TasksStep({
  loading,
  tasks,
  onPick,
  onBack,
}: {
  loading: boolean;
  tasks: string[];
  onPick: (t: string) => void;
  onBack: () => void;
}) {
  return (
    <section>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold leading-tight mb-3">
        I heard a few things.
      </h1>
      <p className="text-ink/70 mb-6">
        Which one are we unsticking right now? Tap one.
      </p>

      {loading ? (
        <div className="card p-8 flex items-center gap-3">
          <span className="dot-loading w-3 h-3 rounded-full bg-rust" />
          <span
            className="dot-loading w-3 h-3 rounded-full bg-mustard"
            style={{ animationDelay: "0.2s" }}
          />
          <span
            className="dot-loading w-3 h-3 rounded-full bg-sage"
            style={{ animationDelay: "0.4s" }}
          />
          <span className="ml-3 text-ink/60">reading the chaos…</span>
        </div>
      ) : (
        <div className="grid gap-3">
          {tasks.map((t, i) => (
            <button
              key={t + i}
              onClick={() => onPick(t)}
              className="chip text-lg"
            >
              <span className="text-ink/40 font-mono text-sm mr-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6">
        <button
          onClick={onBack}
          className="text-sm text-ink/60 hover:text-ink underline underline-offset-4"
        >
          ← rewrite the dump
        </button>
      </div>
    </section>
  );
}

function SetupStep({
  task,
  energy,
  minutes,
  setEnergy,
  setMinutes,
  onBack,
  onGo,
}: {
  task: string;
  energy: Energy | null;
  minutes: Minutes | null;
  setEnergy: (e: Energy) => void;
  setMinutes: (m: Minutes) => void;
  onBack: () => void;
  onGo: () => void;
}) {
  const canGo = !!energy && !!minutes;
  return (
    <section>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-ink/50 mb-2">
          unsticking
        </div>
        <div className="font-display text-2xl sm:text-3xl font-semibold">
          {task}
        </div>
      </div>

      <div className="mb-7">
        <div className="font-display text-xl mb-3">where's your energy?</div>
        <div className="grid grid-cols-3 gap-3">
          <EnergyBtn
            label="fumes"
            emoji="😵"
            selected={energy === "fumes"}
            onClick={() => setEnergy("fumes")}
          />
          <EnergyBtn
            label="kinda here"
            emoji="😐"
            selected={energy === "kinda"}
            onClick={() => setEnergy("kinda")}
          />
          <EnergyBtn
            label="awake"
            emoji="⚡"
            selected={energy === "awake"}
            onClick={() => setEnergy("awake")}
          />
        </div>
      </div>

      <div className="mb-8">
        <div className="font-display text-xl mb-3">how much time?</div>
        <div className="grid grid-cols-3 gap-3">
          <TimeBtn
            label="5 min"
            selected={minutes === 5}
            onClick={() => setMinutes(5)}
          />
          <TimeBtn
            label="15 min"
            selected={minutes === 15}
            onClick={() => setMinutes(15)}
          />
          <TimeBtn
            label="30+ min"
            selected={minutes === 30}
            onClick={() => setMinutes(30)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="text-sm text-ink/60 hover:text-ink underline underline-offset-4"
        >
          ← pick a different one
        </button>
        <button
          disabled={!canGo}
          onClick={onGo}
          className="press-btn bg-rust text-paper font-display font-semibold text-xl px-8 py-4"
        >
          Get Unstuck
        </button>
      </div>
    </section>
  );
}

function EnergyBtn({
  label,
  emoji,
  selected,
  onClick,
}: {
  label: string;
  emoji: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={"chip text-center flex flex-col items-center gap-1 py-4 " + (selected ? "selected" : "")}
    >
      <span className="text-3xl leading-none">{emoji}</span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

function TimeBtn({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={"chip text-center py-5 font-display text-xl " + (selected ? "selected" : "")}
    >
      {label}
    </button>
  );
}

function ActionStep({
  loading,
  result,
  task,
  onReset,
}: {
  loading: boolean;
  result: UnstickResult | null;
  task: string;
  onReset: () => void;
}) {
  const dots = useMemo(() => [0, 1, 2], []);
  const [addingToCalendar, setAddingToCalendar] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const googleClientId = (
    import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  )?.trim();

  async function onAddToCalendar() {
    if (!googleClientId || !result) return;
    setAddingToCalendar(true);
    setCalendarStatus(null);
    try {
      await addTaskToGoogleCalendar(googleClientId, result.action || task);
      setCalendarStatus("Added to your Google Calendar.");
    } catch (err) {
      setCalendarStatus(
        err instanceof Error ? err.message : "Failed to add calendar event."
      );
    } finally {
      setAddingToCalendar(false);
    }
  }

  return (
    <section>
      {loading || !result ? (
        <div className="card p-10 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            {dots.map((i) => (
              <span
                key={i}
                className="dot-loading w-3 h-3 rounded-full bg-ink"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          <div className="font-display text-xl">finding the smallest door in…</div>
        </div>
      ) : (
        <>
          <div className="text-xs uppercase tracking-widest text-ink/50 mb-3">
            do this one thing
          </div>
          <div className="card bg-mustard p-7 sm:p-10 mb-5">
            <div className="font-display text-3xl sm:text-4xl font-semibold leading-[1.15]">
              {result.action}
            </div>
          </div>
          <div className="border-l-[3px] border-ink pl-4 mb-8 text-ink/80 italic">
            {result.validation}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onReset}
              className="press-btn bg-cream font-semibold px-5 py-3"
            >
              start over
            </button>
            <button
              onClick={onAddToCalendar}
              disabled={!googleClientId || addingToCalendar}
              className="press-btn bg-sage text-ink font-semibold px-5 py-3"
              title={
                googleClientId
                  ? "Add this task to Google Calendar"
                  : "Missing VITE_GOOGLE_CLIENT_ID"
              }
            >
              {addingToCalendar ? "adding to calendar..." : "add to calendar"}
            </button>
            <div className="text-sm text-ink/50 sm:ml-auto sm:self-center">
              no streak. no score. close the tab when you're done.
            </div>
          </div>
          {calendarStatus && (
            <div className="mt-3 text-sm text-ink/70">{calendarStatus}</div>
          )}
        </>
      )}
    </section>
  );
}

function Footer() {
  return (
    <footer className="w-full max-w-2xl mx-auto px-5 py-6 text-xs text-ink/40 font-mono flex flex-wrap gap-x-4 gap-y-1 justify-between">
      <span>built for brains that can't start.</span>
      <span>powered by openai</span>
    </footer>
  );
}

function KeyModal({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(
    (typeof window !== "undefined" &&
      (window.localStorage.getItem("OPENAI_API_KEY") ||
        window.localStorage.getItem("ANTHROPIC_API_KEY"))) ||
      ""
  );
  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-5 z-50">
      <div className="card bg-cream w-full max-w-md p-6">
        <div className="font-display text-2xl font-semibold mb-2">
          Live mode
        </div>
        <p className="text-sm text-ink/70 mb-4">
          Paste an OpenAI API key to run with real model responses. Stored
          in your browser only. Leave empty to use demo-mode fallbacks.
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-..."
          className="w-full border-[3px] border-ink bg-paper p-3 font-mono text-sm focus:outline-none mb-4"
        />
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => {
              window.localStorage.removeItem("OPENAI_API_KEY");
              window.localStorage.removeItem("ANTHROPIC_API_KEY");
              onClose();
            }}
            className="press-btn bg-paper text-ink font-semibold px-4 py-2 text-sm"
          >
            clear
          </button>
          <button
            onClick={() => {
              if (value.trim()) {
                window.localStorage.setItem("OPENAI_API_KEY", value.trim());
              }
              onClose();
            }}
            className="press-btn bg-ink text-paper font-semibold px-4 py-2 text-sm"
          >
            save
          </button>
        </div>
      </div>
    </div>
  );
}

function EmailModal({
  connection,
  onConnect,
  onDisconnect,
  onClose,
}: {
  connection: EmailConnection | null;
  onConnect: (next: EmailConnection) => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<EmailProvider>("gmail");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
  
  async function handleConnect() {
    if (provider !== "gmail" || !googleClientId) return;
    setError(null);
    setConnecting(true);
    try {
      const oauth = await connectGoogleEmail(googleClientId);
      const next: EmailConnection = {
        provider: "gmail",
        email: oauth.email,
        connectedAt: new Date().toISOString(),
        inboxPreview: oauth.inboxPreview,
      };
      window.localStorage.setItem(EMAIL_CONNECTION_KEY, JSON.stringify(next));
      onConnect(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth failed.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-md flex items-center justify-center p-5 z-50">
      <div className="card bg-paper w-full max-w-xl p-8 shadow-2xl border-[3px] border-ink">
        {/* Header Section */}
        <div className="mb-8">
          <h2 className="font-display text-3xl font-bold tracking-tight mb-2 text-ink">
            Email Integration
          </h2>
          <p className="text-ink/60 font-body leading-relaxed">
            Connect your inbox to allow the agent to discover relevant context and research materials.
          </p>
        </div>

        {/* Step 1: Select Provider */}
        <div className="mb-8">
          <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-ink/40 mb-4 block">
            01 — Select Provider
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Gmail Option */}
            <button
              onClick={() => {
                setProvider("gmail");
                if (!connection) {
                  void handleConnect();
                }
              }}
              disabled={connecting || !googleClientId}
              className={`flex items-center gap-4 p-4 border-[3px] transition-all text-left ${
                provider === "gmail" 
                  ? "border-ink bg-mustard shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" 
                  : "border-ink/10 bg-cream hover:border-ink/30"
              } ${connecting || !googleClientId ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <span className="text-2xl">✉️</span>
              <div>
                <div className="font-bold font-display">Google Gmail</div>
                <div className="text-xs opacity-70">
                  {connecting ? "Opening OAuth..." : "Official API Access"}
                </div>
              </div>
            </button>

            {/* Outlook Option (Disabled/Coming Soon) */}
            <div className="flex items-center gap-4 p-4 border-[3px] border-ink/5 bg-ink/[0.02] cursor-not-allowed grayscale opacity-50 relative overflow-hidden">
              <span className="text-2xl">📧</span>
              <div>
                <div className="font-bold font-display text-ink/40">Outlook</div>
                <div className="text-[10px] font-mono bg-ink/10 px-1 inline-block">COMING SOON</div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Connection Status / Preview */}
        <div className="mb-10">
          <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-ink/40 mb-4 block">
            02 — Connection Status
          </label>
          
          <div className="bg-cream border-2 border-ink/10 rounded-lg p-5">
            {connection ? (
              <div className="animate-in fade-in slide-in-from-bottom-1">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-sage animate-pulse" />
                    <span className="font-mono text-sm font-bold">{connection.email}</span>
                  </div>
                  <button 
                    onClick={onDisconnect}
                    className="text-[10px] font-bold underline hover:text-rust"
                  >
                    DISCONNECT
                  </button>
                </div>
                
                <div className="space-y-3">
                  {connection.inboxPreview.map((m, i) => (
                    <div key={i} className="text-xs border-l-2 border-mustard pl-3 py-1">
                      <div className="font-bold text-ink truncate">{m.subject}</div>
                      <div className="text-ink/50">from {m.from}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-ink/40 italic font-body">
                  No account linked. Use the button below to authenticate.
                </p>
              </div>
            )}
          </div>
          
          {error && (
            <div className="mt-4 p-3 bg-rust/10 border-l-4 border-rust text-rust text-xs font-mono">
              {error}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-4 border-t-2 border-ink/5 pt-6">
          <button
            onClick={onClose}
            className="text-sm font-bold text-ink/40 hover:text-ink transition-colors"
          >
            Cancel
          </button>

        </div>
      </div>
    </div>
  );
}
