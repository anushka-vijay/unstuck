# The Unstuck Button

**One step. Right now.**  
A hackathon web app built for ADHD initiation paralysis.

The Unstuck Button is designed for ADHD brains: it turns a chaotic brain dump into exactly one tiny, concrete first action.  
No task manager. No streaks. No productivity score. Just enough momentum to start.

## Project Overview

The core interaction is intentionally short and low-pressure:

1. **Brain dump**: user writes whatever is swirling in their head.
2. **Task extraction**: AI (or fallback heuristics) extracts concrete tasks from text, voice transcript, and optional images.
3. **Context selection**: user chooses current energy level and available time.
4. **Single action output**: app returns one embarrassingly small, physical first step with a brief validation line.

The design goal is ADHD-first: reduce startup friction during overwhelm and initiation paralysis so starting feels possible again.

## Features

- Multimodal input:
  - typed brain dump
  - voice capture + transcription (Whisper API)
  - image attachments (included in model prompt)
- AI task extraction from messy input
- AI-generated micro-action constrained to one concrete, observable step
- Safe fallback mode when API key is missing (demo never hard-fails)
- Google Gmail OAuth connection + inbox preview
- Google Calendar context read for action personalization
- One-click add-to-calendar for generated action

## Tech Stack

### Frontend

- **React 19** with **TypeScript**
- **Vite** for dev/build tooling
- **Tailwind CSS** for styling

### AI + External APIs

- **OpenAI Chat Completions API** (`gpt-4o-mini` default) for:
  - task extraction
  - single-step action generation
- **OpenAI Whisper API** for microphone transcription
- **Google Identity Services OAuth 2.0** for auth popups/tokens
- **Gmail API** for inbox preview
- **Google Calendar API** for:
  - upcoming calendar context
  - event creation from generated action

### Architecture

- Client-only app (no backend service)
- No database; state stored in browser memory and `localStorage` where needed

## Local Setup

### Prerequisites

- Node.js 18+ (recommended: latest LTS)
- npm

### Install and run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open the local URL printed by Vite (usually `http://localhost:5173`).

### Environment variables

Create a `.env.local` file with:

```bash
VITE_OPENAI_API_KEY=your_openai_api_key
# optional
VITE_OPENAI_MODEL=gpt-4o-mini
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
```

### Optional: Google OAuth setup (Gmail + Calendar)

1. Create a Google Cloud OAuth **Web application** client.
2. Add local origin to **Authorized JavaScript origins** (e.g. `http://localhost:5173`).
3. Enable Gmail API and Calendar API for the project.
4. Add client ID as `VITE_GOOGLE_CLIENT_ID`.
5. In Google Auth consent configuration, keep app in **Testing** mode and add each user email under **Test users**.
6. Use the in-app login button to connect Gmail.

## Scripts

- `npm run dev` - start local development server
- `npm run build` - type-check and production build
- `npm run preview` - preview production build locally
- `npm run lint` - run ESLint

## Challenges and Solutions

### 1) Reliable output for ADHD overwhelm

- **Challenge:** for ADHD users, generic AI responses often become too broad, motivational, or multi-step, which increases cognitive load and defeats the purpose.
- **Solution:** strict system prompts and output schema force exactly one physical, observable action plus one short validation line.

### 2) Demo reliability under bad network / missing keys

- **Challenge:** hackathon demos fail if external APIs are unavailable.
- **Solution:** local fallback logic for task extraction and action generation ensures graceful behavior even without an API key.

### 3) Multimodal signal merging

- **Challenge:** users express context through text, voice, and screenshots; one channel may be incomplete.
- **Solution:** unified prompt strategy merges all modalities and resolves conflicts toward concrete, actionable interpretation.

### 4) OAuth complexity in a client-only app

- **Challenge:** integrating Gmail/Calendar securely without a backend increases token-flow and error-state complexity.
- **Solution:** Google Identity Services token flow, scoped permissions, explicit popup/error handling, and clear degraded-mode behavior.

### 5) Preserving low cognitive load in UX

- **Challenge:** adding integrations can make the product feel heavy or "productivity-tool-ish."
- **Solution:** a strict 4-step flow, minimal copy, and one-action output keep interaction short and non-overwhelming.

## Demo Video

Add the Devpost demo link here (must be under 60 seconds):

- `[Demo Video URL](https://example.com)`

## Team

Add all team members on the Devpost project page and list them here:

- Anushka Vijay
- Swathi Murali
- Madur Malliah
- Namra Shah