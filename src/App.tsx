import { useEffect, useMemo, useRef, useState } from "react";
import {
  extractTasks,
  getUnstickAction,
  hasApiKey,
  transcribeAudio,
  type BrainImage,
  type Energy,
  type Minutes,
  type UnstickResult,
} from "./lib/claude";
import {
  connectGoogleEmail,
  type InboxPreviewItem,
} from "./lib/emailOAuth";
import {
  addTaskToGoogleCalendar,
  fetchCalendarContext,
  getCalendarEventPreview,
} from "./lib/googleCalendar";

type Step = "dump" | "tasks" | "setup" | "action";
type EmailProvider = "gmail" | "outlook";

interface EmailConnection {
  provider: EmailProvider;
  email: string;
  connectedAt: string;
  inboxPreview: InboxPreviewItem[];
}

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
  const [images, setImages] = useState<BrainImage[]>([]);
  const [tasks, setTasks] = useState<string[]>([]);
  const [task, setTask] = useState<string>("");
  const [energy, setEnergy] = useState<Energy | null>(null);
  const [minutes, setMinutes] = useState<Minutes | null>(null);
  const [result, setResult] = useState<UnstickResult | null>(null);

  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(
    readEmailConnection()
  );
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const stepIndex: Record<Step, number> = {
    dump: 0,
    tasks: 1,
    setup: 2,
    action: 3,
  };

  async function onExtractTasks() {
    if (!dump.trim() && images.length === 0) return;
    setLoadingTasks(true);
    setStep("tasks");
    try {
      const list = await extractTasks(dump.trim(), images);
      setTasks(list);
    } finally {
      setLoadingTasks(false);
    }
  }

  function onPickTask(t: string) {
    setTask(t);
    setStep("setup");
  }

  function onLetStart() {
    if (tasks.length === 0) return;
    const availableTasks = tasks.filter((t) => t.trim() !== "");
    if (availableTasks.length === 0) return;
    // Pick a random task from the list
    const picked = availableTasks[Math.floor(Math.random() * availableTasks.length)];
    onPickTask(picked);
  }

  function onKeepWorking() {
    const remaining = tasks.filter((t) => t !== task && t.trim() !== "");
    setTasks(remaining);
    
    if (remaining.length > 0) {
      const picked = remaining[Math.floor(Math.random() * remaining.length)];
      setTask(picked);
      setEnergy(null);
      setMinutes(null);
      setResult(null);
      setStep("setup");
    } else {
      reset();
    }
  }

  async function onGetUnstuck() {
    if (!task || !energy || !minutes) return;
    setLoadingAction(true);
    setStep("action");
    try {
      const googleClientId = (
        import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
      )?.trim();
      let calendarContext: string | undefined = undefined;
      if (googleClientId) {
        try {
          calendarContext = await fetchCalendarContext(googleClientId);
        } catch (err) {
          console.warn("Calendar context unavailable; continuing.", err);
        }
      }
      const r = await getUnstickAction({
        dump: dump.trim(),
        task,
        energy,
        minutes,
        images,
        calendarContext,
      });
      setResult(r);
    } finally {
      setLoadingAction(false);
    }
  }

  function reset() {
    setStep("dump");
    setDump("");
    setImages([]);
    setTasks([]);
    setTask("");
    setEnergy(null);
    setMinutes(null);
    setResult(null);
  }

  async function handleAddImages(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    const loaded = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<BrainImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ name: file.name, dataUrl: String(reader.result || "") });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          })
      )
    );
    setImages((prev) => [...prev, ...loaded]);
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function toggleRecording() {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Detect supported mime type
        const mimeType = MediaRecorder.isTypeSupported("audio/webm") 
          ? "audio/webm" 
          : "audio/mp4";
          
        const recorder = new MediaRecorder(stream, { mimeType });
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.start(100); // Collect data every 100ms for better reliability
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
      } catch (err) {
        console.error("Microphone access denied or failed:", err);
        alert("Could not access microphone. Please check your browser permissions.");
      }
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    const audioBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        resolve(blob);
      };
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
    });

    setIsRecording(false);
    setIsTranscribing(true);

    if (audioBlob.size < 100) {
      console.warn("Audio blob too small, likely no data recorded.");
      setIsTranscribing(false);
      return;
    }

    try {
      const transcript = await transcribeAudio(audioBlob);
      if (transcript.trim()) {
        setDump((prev) => (prev ? `${prev}\n\n${transcript}` : transcript));
      }
    } catch (err) {
      console.error("Transcription failed:", err);
      alert(err instanceof Error ? err.message : "Transcription failed. Check your API key and microphone permissions.");
    } finally {
      setIsTranscribing(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col">
      <Header
        emailConnection={emailConnection}
        onConfigureEmail={() => setShowEmailModal(true)}
      />

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 pb-24">
        <ProgressDots current={stepIndex[step]} />

        <div key={step} className="anim-in">
          {step === "dump" && (
            <DumpStep
              dump={dump}
              images={images}
              isRecording={isRecording}
              isTranscribing={isTranscribing}
              onChange={setDump}
              onAddImages={handleAddImages}
              onRemoveImage={removeImage}
              onToggleMic={toggleRecording}
              onNext={onExtractTasks}
            />
          )}
          {step === "tasks" && (
            <TasksStep
              loading={loadingTasks}
              tasks={tasks}
              setTasks={setTasks}
              onStart={onLetStart}
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
              onKeepWorking={onKeepWorking}
              hasMoreTasks={tasks.length > 1}
            />
          )}
        </div>
      </main>

      <Footer />

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
  emailConnection,
  onConfigureEmail,
}: {
  emailConnection: EmailConnection | null;
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
          <span className="text-sm">{username ? "👤" : "🔑"}</span>
          <span>{username ? username : "login"}</span>
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
  images,
  isRecording,
  isTranscribing,
  onChange,
  onAddImages,
  onRemoveImage,
  onToggleMic,
  onNext,
}: {
  dump: string;
  images: BrainImage[];
  isRecording: boolean;
  isTranscribing: boolean;
  onChange: (v: string) => void;
  onAddImages: (files: FileList | File[] | null) => void;
  onRemoveImage: (index: number) => void;
  onToggleMic: () => Promise<void>;
  onNext: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const canGo = dump.trim().length >= 3 || images.length > 0;

  function handlePasteImages(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files || []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length > 0) {
      e.preventDefault();
      onAddImages(files);
    }
  }

  function handleDropImages(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length > 0) {
      onAddImages(files);
    }
  }

  return (
    <section>
      <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-[1.05] mb-3">
        What's swirling?
      </h1>
      <p className="text-ink/70 mb-6">
        Dump it here. Messy is fine — actually preferred.
      </p>

      <div
        className="card p-1 mb-5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropImages}
      >
        <textarea
          ref={ref}
          value={dump}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePasteImages}
          placeholder="ugh i have to email my prof and the thing due friday and i haven't eaten and i don't know where to start"
          className="w-full h-48 sm:h-56 resize-none bg-cream p-5 font-body text-lg leading-relaxed focus:outline-none placeholder:text-ink/30"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canGo) {
              onNext();
            }
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <label className="press-btn bg-paper px-4 py-2 text-sm cursor-pointer">
          <span className="text-lg leading-none" aria-label="add image">
            📷
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onAddImages(e.target.files)}
          />
        </label>
        <button
          onClick={() => void onToggleMic()}
          className={`press-btn px-4 py-2 text-sm ${
            isRecording ? "bg-rust text-paper" : "bg-paper text-ink"
          }`}
          aria-label={isRecording ? "stop recording" : "start voice input"}
          title={isRecording ? "Stop recording" : "Start voice input"}
        >
          <span className="text-lg leading-none">🎤</span>
        </button>
        {isTranscribing && (
          <span className="text-xs text-ink/60 font-mono">transcribing…</span>
        )}
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
          {images.map((img, i) => (
            <div key={img.name + i} className="card bg-paper p-2">
              <img
                src={img.dataUrl}
                alt={img.name}
                className="w-full h-24 object-cover border-2 border-ink/10"
              />
              <div className="text-xs mt-2 truncate">{img.name}</div>
              <button
                onClick={() => onRemoveImage(i)}
                className="text-xs underline text-ink/60 hover:text-ink"
              >
                remove
              </button>
            </div>
          ))}
        </div>
      )}

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
  setTasks,
  onStart,
  onBack,
}: {
  loading: boolean;
  tasks: string[];
  setTasks: (t: string[]) => void;
  onStart: () => void;
  onBack: () => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const updateTask = (index: number, val: string) => {
    const next = [...tasks];
    next[index] = val;
    setTasks(next);
  };

  const deleteTask = (index: number) => {
    setTasks(tasks.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  const addTask = () => {
    const next = [...tasks, ""];
    setTasks(next);
    setEditingIndex(next.length - 1);
  };

  return (
    <section className="max-w-4xl mx-auto">
      <h1 className="font-display text-3xl sm:text-4xl font-semibold leading-tight mb-3">
        I hear you ...
      </h1>
      <p className="text-ink/70 mb-6">
        Review your tasks or add your own. We'll pick the best one to start with.
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((t, i) => (
            <div key={i} className="chip h-full min-h-[140px] flex flex-col justify-between group relative overflow-hidden bg-cream p-5">
              <div className="flex-1">
                {editingIndex === i ? (
                  <textarea
                    autoFocus
                    value={t}
                    onChange={(e) => updateTask(i, e.target.value)}
                    onBlur={() => setEditingIndex(null)}
                    className="w-full h-full bg-transparent border-none focus:ring-0 focus:outline-none text-lg font-medium resize-none"
                    placeholder="Describe the task..."
                  />
                ) : (
                  <div className="text-lg font-medium leading-snug break-words">
                    {t}
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-end gap-1 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setEditingIndex(i)}
                  className="p-2 hover:bg-ink/5 rounded-lg transition-colors"
                  title="Edit task"
                >
                  <span role="img" aria-label="edit">✏️</span>
                </button>
                <button
                  onClick={() => deleteTask(i)}
                  className="p-2 hover:bg-rust/10 rounded-lg transition-colors"
                  title="Remove task"
                >
                  <span role="img" aria-label="delete">🗑️</span>
                </button>
              </div>
            </div>
          ))}

          {/* Add Task Tile */}
          <button
            onClick={addTask}
            className="chip h-full min-h-[140px] flex flex-col items-center justify-center border-dashed border-ink/20 bg-ink/5 hover:bg-ink/10 hover:border-ink/40 transition-all group"
            title="Add a manual task"
          >
            <span className="text-4xl text-ink/40 group-hover:text-ink/60 transition-colors">+</span>
            <span className="text-xs uppercase tracking-widest text-ink/40 mt-2">Add Task</span>
          </button>

          {tasks.length === 0 && (
            <div className="col-span-full text-center py-12 text-ink/40 italic card">
              No tasks found. Try adding some back or rewriting your dump.
            </div>
          )}
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="mt-10">
          <button
            onClick={onStart}
            className="press-btn w-full bg-ink text-paper font-semibold px-6 py-5 text-xl"
          >
            Let's get started →
          </button>
        </div>
      )}

      <div className="mt-8">
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
  onKeepWorking,
  hasMoreTasks,
}: {
  loading: boolean;
  result: UnstickResult | null;
  task: string;
  onReset: () => void;
  onKeepWorking: () => void;
  hasMoreTasks: boolean;
}) {
  const dots = useMemo(() => [0, 1, 2], []);
  const [addingToCalendar, setAddingToCalendar] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [showCalendarPreview, setShowCalendarPreview] = useState(false);
  const googleClientId = (
    import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  )?.trim();
  const calendarPreview = useMemo(
    () => getCalendarEventPreview((result?.action || task || "").trim()),
    [result, task]
  );

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
          <div
            className="relative"
            onMouseLeave={() => setShowCalendarPreview(false)}
          >
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={onReset}
                className="press-btn bg-cream font-semibold px-5 py-3"
              >
                start over
              </button>
              {hasMoreTasks && (
                <button
                  onClick={onKeepWorking}
                  className="press-btn bg-sage text-ink font-semibold px-5 py-3"
                >
                  keep working
                </button>
              )}
              <button
                onClick={onAddToCalendar}
                onMouseEnter={() => setShowCalendarPreview(true)}
                onFocus={() => setShowCalendarPreview(true)}
                onBlur={() => setShowCalendarPreview(false)}
                disabled={!googleClientId || addingToCalendar}
                className="press-btn bg-rust text-paper font-semibold px-5 py-3"
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
            {showCalendarPreview && (
              <div className="pointer-events-none absolute left-0 right-0 top-full mt-2 z-20 card bg-paper p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-ink/40 mb-2">
                  Calendar Preview
                </div>
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-[56px_1fr] items-start gap-2">
                    <span className="font-mono text-ink/50">task</span>
                    <span className="font-semibold text-ink">{calendarPreview.summary}</span>
                  </div>
                  <div className="grid grid-cols-[56px_1fr] items-start gap-2">
                    <span className="font-mono text-ink/50">date</span>
                    <span className="text-ink/80">{calendarPreview.dateLabel}</span>
                  </div>
                  <div className="grid grid-cols-[56px_1fr] items-start gap-2">
                    <span className="font-mono text-ink/50">time</span>
                    <span className="text-ink/80">{calendarPreview.timeRangeLabel}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-3 text-sm text-ink/70 min-h-6">
            {calendarStatus || ""}
          </div>
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
