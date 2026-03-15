<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Sweep2

Local-only LLM powered Gmail cleanup tool.

## What changed

- Gemini support has been removed completely.
- The app now supports **local LLM only** through the backend proxy at `/api/generate`.
- `firebase-applet-config.json` is no longer used or committed. Configure Firebase through environment variables instead.

## Run locally

Prerequisites:
- Node.js 20+
- A local LLM endpoint such as Ollama

1. Copy `.env.example` to `.env.local` or `.env`
2. Set your Firebase values
3. Set your local model endpoint, for example:
   - `LOCAL_LLM_ENDPOINT=http://localhost:11434/api/generate`
   - `LOCAL_LLM_MODEL=llama3`
4. Install dependencies:
   - `npm install`
5. Run the app:
   - `npm run dev`

## Docker notes

- The backend proxies local LLM calls to the configured endpoint.
- In Docker, `localhost` inside the container is the container itself. Point `LOCAL_LLM_ENDPOINT` to a reachable host/service, such as `http://host.docker.internal:11434/api/generate` where supported.
- SQLite persists to `/app/data/sweep.db` by default.
