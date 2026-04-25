import Anthropic from "@anthropic-ai/sdk";

export type Energy = "fumes" | "kinda" | "awake";
export type Minutes = 5 | 15 | 30;

export interface UnstickInput {
  dump: string;
  task: string;
  energy: Energy;
  minutes: Minutes;
}

export interface UnstickResult {
  action: string;
  validation: string;
}

const MODEL = "claude-sonnet-4-5";

function getClient(): Anthropic | null {
  const apiKey =
    (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) ||
    (typeof window !== "undefined"
      ? window.localStorage.getItem("ANTHROPIC_API_KEY") || undefined
      : undefined);
  if (!apiKey) return null;
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export function hasApiKey(): boolean {
  return !!getClient();
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

const TASK_EXTRACT_SYSTEM = `You read a messy brain-dump from someone with ADHD who is frozen and cannot start.
Your only job is to surface the 2-3 most concrete things they mentioned that might be the one
thing they're trying to start right now. You are not a planner. You are not a coach.

Rules:
- Reply ONLY with JSON: {"tasks": ["...", "...", "..."]}
- 2-3 items. Never more than 3.
- Each item: 3-6 words. Starts lowercase. No trailing punctuation. No emoji.
- Concrete and specific, using nouns FROM the user's own dump. Not a category.
- Good: "email professor about extension". Bad: "the writing thing" or "school stuff".
- Skip venting and feelings. Pull out the actual task or decision hiding in the mess.
- If truly nothing concrete exists, return ONE best-guess task + "pick the smallest one".

Examples:

Dump: "ugh i have to email my prof back and the essay due friday and i haven't eaten"
→ {"tasks": ["email the professor", "friday essay", "eat something"]}

Dump: "i'm panicking about the presentation and i've only made one slide"
→ {"tasks": ["finish the slide deck", "write the opening line", "pick the first slide to fix"]}

Dump: "kitchen is disgusting and my mom texted tuesday and laundry is piling up"
→ {"tasks": ["reply to mom's text", "start the laundry", "clean the kitchen"]}`;

export async function extractTasks(dump: string): Promise<string[]> {
  const client = getClient();
  if (!client) return fallbackTasks(dump);
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: TASK_EXTRACT_SYSTEM,
      messages: [{ role: "user", content: dump }],
    });
    const block = resp.content.find((c) => c.type === "text");
    if (!block || block.type !== "text") return fallbackTasks(dump);
    const parsed = JSON.parse(stripCodeFence(block.text));
    const tasks: unknown = parsed?.tasks;
    if (!Array.isArray(tasks)) return fallbackTasks(dump);
    return tasks
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch (err) {
    console.warn("extractTasks failed, using fallback", err);
    return fallbackTasks(dump);
  }
}

const ACTION_SYSTEM = `You are The Unstuck Button. The user has ADHD initiation paralysis — a
neurological inability to start, not a motivation problem. They told you the chaos in their head,
confirmed the one thing they're actually trying to start, their energy, and their time.

Your ONLY output is ONE embarrassingly small, concrete, physical first step — the kind of step
a productivity coach would never suggest because it's "too small to matter." That smallness IS
the medicine. Dopamine-starved brains need a win so tiny it feels silly to refuse.

HARD RULES for the action:
- ONE step. Not a list. Not "then X". Not "and then". Just one.
- Start with a verb (imperative or "you"). Present tense.
- PHYSICAL and OBSERVABLE. An outsider watching them should be able to see it happen.
- CONCRETE nouns. Name the actual app, doc, person, object — not a category.
  Good: "open Gmail. in the To field, type Professor Smith's name."
  Bad:  "open your email and start writing."
- Include a SPECIFIC STOP CONDITION so they know when they're done with this step.
  Good endings: "…that's it.", "…then stop.", "…close the tab if you want.", "…don't fix anything yet."
- Match energy × time:
  • fumes + 5      → bodily only. stand up, open one tab, type one word, put the notebook on the desk.
  • fumes + 15/30  → one small observable step, gently paced. set a timer, open the doc, type the date.
  • kinda + 5      → open the thing + type one ugly sentence + stop.
  • kinda + 15/30  → 10-minute timer, worst-first-draft mode, no editing allowed.
  • awake + any    → still ONE step, but meatier: "write the first paragraph on purpose badly."
- Give PERMISSION TO DO IT BADLY when writing/creating is involved. Use phrases like
  "ugly on purpose", "worst possible first draft", "don't fix anything", "just the first line".

FORBIDDEN words and phrases (never use these — they are the disease, not the cure):
- "start working on", "begin", "tackle", "dive into", "get going on"
- "make a list", "plan out", "organize", "prioritize", "break it down"
- "take a few minutes to think about", "brainstorm", "reflect"
- "you got this", "you can do it", "amazing", "proud of you", any exclamation marks
- any mention of ADHD, focus, discipline, productivity, streaks, scores

VALIDATION LINE (second field):
≤12 words. Warm and flat, not peppy. Honest, not saccharine.
Good: "that's the whole job right now." / "the rest can wait — this is enough."
      / "you don't have to feel ready. just do the one thing."
Bad:  anything with "!" or "you got this" or "keep going" or emoji.

OUTPUT FORMAT:
Reply ONLY with JSON. No preamble. No markdown fences.
{"action": "...", "validation": "..."}

EXAMPLES:

Task: "email the professor"
Energy: fumes (running on fumes)  Time: 5
→ {"action": "open Gmail. in the To field, type your professor's name until it autocompletes. that's it. don't write the email.",
   "validation": "starting the container counts. the words can come later."}

Task: "friday essay"
Energy: kinda (kinda here)  Time: 15
→ {"action": "open the essay doc and type the worst possible opening sentence. ugly on purpose. do not delete it.",
   "validation": "the first sentence is the door. you don't have to like it."}

Task: "finish the slide deck"
Energy: fumes (running on fumes)  Time: 5
→ {"action": "open the slide deck and read slide one out loud to yourself. close the laptop if you want.",
   "validation": "hearing it counts as starting. you already did the hard part."}

Task: "clean the kitchen"
Energy: awake (actually awake)  Time: 30
→ {"action": "set a 15-minute timer. pick up ONLY things that are trash. not dishes. not clothes. only trash. stop when it rings.",
   "validation": "one category is a full job. the rest doesn't exist right now."}

Task: "reply to mom's text"
Energy: kinda (kinda here)  Time: 5
→ {"action": "open the text thread with your mom and type the two words 'hey sorry'. don't finish the message. just those two words.",
   "validation": "she'll see the typing dots. that's enough to reopen the door."}`;

export async function getUnstickAction(
  input: UnstickInput
): Promise<UnstickResult> {
  const client = getClient();
  if (!client) return fallbackAction(input);

  const energyLabel = {
    fumes: "fumes (running on fumes, barely here)",
    kinda: "kinda (kinda here, not great not terrible)",
    awake: "awake (actually awake, could do a thing)",
  }[input.energy];

  const userMsg = `Task they picked: "${input.task}"
Energy: ${energyLabel}
Time available: ${input.minutes} minutes

Full brain dump for context (do NOT summarize this, use it only to understand the specific situation):
"""
${input.dump}
"""

Give them ONE embarrassingly small, concrete, physical first step. Name specific apps, docs, people, or objects from their dump. Include a stop condition so they know when they're done with this step. Reply with JSON only.`;

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: ACTION_SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });
    const block = resp.content.find((c) => c.type === "text");
    if (!block || block.type !== "text") return fallbackAction(input);
    const parsed = JSON.parse(stripCodeFence(block.text));
    const action = typeof parsed?.action === "string" ? parsed.action.trim() : "";
    const validation =
      typeof parsed?.validation === "string" ? parsed.validation.trim() : "";
    if (!action) return fallbackAction(input);
    return {
      action,
      validation: validation || "that's the whole job right now.",
    };
  } catch (err) {
    console.warn("getUnstickAction failed, using fallback", err);
    return fallbackAction(input);
  }
}

// --- Fallbacks so the live demo never dies. ---
// These mirror the shape of the real Claude output: concrete, physical, specific.

type TaskKind =
  | "email"
  | "writing"
  | "presentation"
  | "cleaning"
  | "code"
  | "eating"
  | "sleep"
  | "message"
  | "reading"
  | "generic";

function classifyTask(text: string): TaskKind {
  const t = text.toLowerCase();
  if (/\bemail|inbox|reply|prof(essor)?\b/.test(t)) return "email";
  if (/\bessay|paper|assignment|homework|report|thesis|writ(e|ing)\b/.test(t))
    return "writing";
  if (/\bpresent|slide|deck|pitch|demo\b/.test(t)) return "presentation";
  if (/\bclean|room|dish|laundry|tidy|kitchen\b/.test(t)) return "cleaning";
  if (/\bcode|bug|pr|ticket|issue|deploy|merge\b/.test(t)) return "code";
  if (/\beat|food|meal|lunch|dinner|hungry|snack\b/.test(t)) return "eating";
  if (/\bsleep|bed|tired|rest|exhaust|nap\b/.test(t)) return "sleep";
  if (/\bcall|phone|text|message|mom|dad|friend\b/.test(t)) return "message";
  if (/\bread|study|notes|chapter|review\b/.test(t)) return "reading";
  return "generic";
}

function fallbackTasks(dump: string): string[] {
  const lower = dump.toLowerCase();
  const guesses: string[] = [];
  const patterns: [RegExp, string][] = [
    [/\b(email|e-mail|inbox|reply)\b/, "reply to the email"],
    [/\bprof(essor)?\b/, "email the professor"],
    [/\b(essay|paper|assignment|homework|thesis)\b/, "the essay / assignment"],
    [/\b(present|slide|deck|pitch|demo)\b/, "the slide deck"],
    [/\b(kitchen|dish)\b/, "clean the kitchen"],
    [/\blaundry\b/, "start the laundry"],
    [/\broom|tidy\b/, "pick up the room"],
    [/\b(code|bug|pr|ticket|issue)\b/, "the code ticket"],
    [/\b(eat|food|meal|lunch|dinner|hungry)\b/, "eat something"],
    [/\b(sleep|bed|tired|rest|nap)\b/, "go to bed"],
    [/\btext|message\b/, "reply to the text"],
    [/\b(call|phone)\b/, "make the call"],
    [/\bmom\b/, "reply to mom"],
    [/\bdad\b/, "reply to dad"],
    [/\b(read|study|notes|chapter|review)\b/, "the reading"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(lower) && !guesses.includes(label)) guesses.push(label);
    if (guesses.length >= 3) break;
  }
  if (guesses.length === 0) guesses.push("the main thing on your mind");
  if (guesses.length < 2) guesses.push("pick the smallest piece");
  return guesses.slice(0, 3);
}

// Concrete templates keyed by (task kind, energy) and scaled by time.
// Every output names a specific object, app, or verb — no generic "${task}".
const ACTION_TEMPLATES: Record<
  TaskKind,
  Record<Energy, { short: string; long: string }>
> = {
  email: {
    fumes: {
      short:
        "open your email. in the To field, type the first letter of their name until it autocompletes. that's it. don't write the email yet.",
      long: "open your email. type their name into the To field. type one sentence: \"hey, sorry for the delay\". stop there. don't send, don't edit.",
    },
    kinda: {
      short:
        "open the email draft. type the subject line only. make it ugly and direct, like \"quick question\". stop.",
      long: "set a 10-minute timer. write the email in the worst possible way — no greeting, no closing, just the ask. don't send it yet, just get the words out.",
    },
    awake: {
      short:
        "open the email. type the subject line and the first sentence. don't worry about tone. just the first sentence, then stop.",
      long: "set a 15-minute timer. write the full email in one pass, ugly on purpose. no editing until the timer rings.",
    },
  },
  writing: {
    fumes: {
      short:
        "open the document. type today's date at the top. close the laptop if you want. you showed up.",
      long: "open the document and type a single bad sentence about what the piece is even about. it can be wrong. leave it there.",
    },
    kinda: {
      short:
        "open the doc and type the worst possible opening sentence. ugly on purpose. do not delete it.",
      long: "set a 10-minute timer. write the first paragraph in the worst possible way. no editing, no deleting. just get ugly words on the page.",
    },
    awake: {
      short:
        "open the doc. write one full paragraph on purpose badly. you will fix it later, not now.",
      long: "set a 25-minute timer. write the first page in worst-first-draft mode. no backspacing allowed until it rings.",
    },
  },
  presentation: {
    fumes: {
      short:
        "open the slide deck. read slide one out loud to yourself. close the laptop if you want.",
      long: "open the deck and fix ONE word on ONE slide. any word. then close it. that counts.",
    },
    kinda: {
      short:
        "open the deck. duplicate the last slide so you have a blank canvas. type a title. stop.",
      long: "set a 10-minute timer. add or fix one slide — no more. done means timer ended, not slide finished.",
    },
    awake: {
      short: "open the deck. fix the title slide first. nothing else yet.",
      long: "set a 20-minute timer. work through the deck linearly from slide one. no jumping around. stop when it rings.",
    },
  },
  cleaning: {
    fumes: {
      short:
        "stand up. walk into the room. pick up ONE piece of trash. put it in the trash. sit back down.",
      long: "set a 5-minute timer. pick up only things that are trash. not dishes, not clothes. only trash. stop when it rings.",
    },
    kinda: {
      short: "walk in. pick up 3 things. any 3. that's it.",
      long: "set a 10-minute timer. pick up only one category — trash OR dishes OR clothes. pick one. stop when it rings.",
    },
    awake: {
      short:
        "start a 5-minute timer. put on one song. clean only what fits in the song.",
      long: "set a 15-minute timer. pick ONE category (trash, dishes, or clothes) and do only that. other categories don't exist right now.",
    },
  },
  code: {
    fumes: {
      short:
        "open the repo. open the file name you remember from last time. read the first function. don't type anything.",
      long: "open the ticket and re-read only the title and first line. close it. that's enough context for right now.",
    },
    kinda: {
      short:
        "open the file. write one failing test. make it ugly. don't fix it yet.",
      long: "set a 10-minute timer. write the ugliest possible version of the function that compiles. don't worry about edge cases.",
    },
    awake: {
      short: "open the PR. leave one comment on your own code. any comment.",
      long: "set a 25-minute timer. do the ugly first pass of the change. tests later, types later, just make it work once.",
    },
  },
  eating: {
    fumes: {
      short:
        "stand up. walk to the kitchen. drink a glass of water. that counts.",
      long: "walk to the kitchen. eat one thing you don't have to prepare. cereal. a piece of bread. yogurt. three minutes max.",
    },
    kinda: {
      short: "make toast. just toast. nothing on it is fine.",
      long: "set a 10-minute timer. make one thing that requires the microwave or toaster only. stop when the timer rings.",
    },
    awake: {
      short: "pick the easiest thing in the fridge. eat it standing up.",
      long: "cook one thing that takes 15 minutes or less. no recipe. no optimization. just heat and eat.",
    },
  },
  sleep: {
    fumes: {
      short:
        "stand up. walk to your bed. lie down on top of the covers. don't change yet. just lie down.",
      long: "put your phone in another room. change into anything softer than what you're wearing. get in bed. that's the whole job.",
    },
    kinda: {
      short:
        "stop what you're doing. brush your teeth only. come back to bed, nothing else.",
      long: "15-minute wind-down: phone on the dresser, teeth brushed, lights off. no other tasks count right now.",
    },
    awake: {
      short:
        "close every tab except one. stand up. walk to the bedroom. start there.",
      long: "set a 15-minute timer for a wind-down. anything that's not brushing teeth, changing, or turning off lights is not allowed.",
    },
  },
  message: {
    fumes: {
      short:
        "open the thread. type the two words \"hey sorry\". don't finish. just those two words.",
      long: "open the thread. type one sentence, any sentence, no editing. stop there. sending is optional for now.",
    },
    kinda: {
      short:
        "open the thread. type a one-line reply. misspellings are allowed. hit send.",
      long: "set a 5-minute timer. write the reply in the worst possible way. hit send before it rings.",
    },
    awake: {
      short:
        "open the thread and reply with one honest sentence. don't overexplain.",
      long: "write the reply in under 3 sentences. send it within 10 minutes. perfect is the enemy here.",
    },
  },
  reading: {
    fumes: {
      short:
        "open the reading. read only the title and the first sentence. close it.",
      long: "open the reading and read only the first paragraph. close it. that counts as starting.",
    },
    kinda: {
      short:
        "set a 5-minute timer. read until it rings. stop mid-sentence if you have to.",
      long: "set a 10-minute timer. read one section only. highlight nothing, take no notes. just eyes on words.",
    },
    awake: {
      short:
        "open to where you left off. read for 10 minutes. timer optional.",
      long: "set a 25-minute timer. read one section. no note-taking, no re-reading. just forward motion.",
    },
  },
  generic: {
    fumes: {
      short:
        "open the app or doc this lives in. put your hands on the keyboard. that's it. close it if you want.",
      long: "open the relevant app or doc. type one ugly sentence about the very next thing. don't fix it.",
    },
    kinda: {
      short:
        "set a 5-minute timer. open the thing and do the first ugly version of step one. stop when it rings.",
      long: "set a 10-minute timer. worst-first-draft mode. no editing, no planning, just the first ugly pass.",
    },
    awake: {
      short:
        "open the thing. do the first concrete action you can name out loud. stop after one.",
      long: "set a 20-minute timer. do the ugly first pass. the goal is ugly-but-real, not correct.",
    },
  },
};

function fallbackAction(input: UnstickInput): UnstickResult {
  const kind = classifyTask(input.task);
  const template = ACTION_TEMPLATES[kind][input.energy];
  const action = input.minutes === 5 ? template.short : template.long;
  const validation = pickValidation(input.energy, kind);
  return { action, validation };
}

function pickValidation(energy: Energy, kind: TaskKind): string {
  if (energy === "fumes") {
    return kind === "sleep"
      ? "getting horizontal counts. the rest can wait."
      : "showing up counts. the rest can wait.";
  }
  if (kind === "message" || kind === "email") {
    return "sent-and-imperfect beats unsent-and-perfect every time.";
  }
  if (kind === "writing" || kind === "presentation") {
    return "ugly words on the page is the whole job right now.";
  }
  return "that's the whole job right now. the rest doesn't exist yet.";
}
