# The Unstuck Button

**One step. Right now.** A hackathon demo for ADHD initiation paralysis — built
around the idea that the first step shouldn't be the hardest part.

You dump whatever's swirling, the model extracts the 2–3 things it heard,
you tap the one you're actually trying to start, pick your energy + time,
and get back exactly **one** embarrassingly-small first action.

No lists. No streaks. No productivity scoreboard. Close the tab when you're done.

## Stack

- Vite + React + TypeScript
- Tailwind CSS (warm-brutalist theme: cream paper, thick borders, chunky shadows)
- OpenAI Chat Completions API called directly from the browser
- Zero backend. Zero database.

## Setup

```bash
npm install
cp .env.example .env.local
# open .env.local and paste your OpenAI API key
# optional: add VITE_GOOGLE_CLIENT_ID for real Gmail OAuth connect
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

### No API key? Still works.

If `VITE_OPENAI_API_KEY` is missing, the app drops into **demo mode**: task
extraction uses keyword heuristics and the micro-action comes from a set of
pre-written fallbacks sized to energy + time. The live demo literally cannot
crash on stage.

You can also click the `● live / ○ demo mode` pill in the top right of the app
to paste a key at runtime (stored only in `localStorage`, never leaves the
browser).

### Real email OAuth (Gmail)

To enable the real "connect email" flow:

- create a Google OAuth **Web application** client in Google Cloud Console
- set `Authorized JavaScript origins` to your Vite origin (for local: `http://localhost:5173`)
- copy the client ID into `.env.local` as `VITE_GOOGLE_CLIENT_ID`

Then click `✉ connect email` in the app header and connect Gmail. The modal
will fetch a small inbox preview via Gmail API.

## The 4-step flow

1. **Brain dump** — one big textarea. No structure. Messy is preferred. Cmd/Ctrl+Enter to submit.
2. **Task chips** — the model reads the chaos, surfaces 2–3 specific things you mentioned, plus a "something else entirely" escape hatch. Tap one.
3. **Energy + time** — three buttons each. Fumes / kinda here / awake, and 5 / 15 / 30+ min.
4. **One micro-action** — mustard card with the single smallest physical first step, plus a short non-saccharine validation line.

That's the whole app.

## Demo notes

- The big `Get Unstuck` button has a 3D chunky-shadow press — satisfying to
  hit on stage.
- Progress dots track the 4 steps without drawing attention.
- Type something genuinely chaotic on stage. The messier the input, the
  harder the output lands.
- Fallbacks were designed to still feel on-brand if you go offline mid-demo.

## Why this exists

> "Every productivity tool assumes you can prioritize, sequence, and initiate.
> That assumption is exactly the disability. We're not optimizing productivity
> — we're removing the neurological barrier to starting."

The first step shouldn't be the hardest part.
