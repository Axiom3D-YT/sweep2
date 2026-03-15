# Sweep: Docker Deployment Guide

This guide provides instructions for deploying the **Sweep Email Cleaner** using Docker.

## 1. Prerequisites

Before you begin, ensure you have the following:
- **Docker** installed on your machine.
- **Google Cloud Console Credentials**: A Client ID and Client Secret for Gmail API access.
- **Firebase Project**: A configuration for Google Authentication.
- **Google AI Studio API Key**: For Gemini-powered analysis (optional if using a local LLM).

---

## 2. Configuration Files

### A. Environment Variables (`.env`)
Create a `.env` file in the project root with the following variables:

```env
# Google Gemini API Key (Required for Cloud Run mode)
GEMINI_API_KEY=your_gemini_api_key_here

# Port for the application (Default is 3000)
PORT=3000

# Node Environment
NODE_ENV=production
```

### B. Firebase Configuration (`src/firebase-applet-config.json`)
Ensure your Firebase configuration is present at `src/firebase-applet-config.json`. This is required for the Google Login to function.

```json
{
  "apiKey": "...",
  "authDomain": "...",
  "projectId": "...",
  "storageBucket": "...",
  "messagingSenderId": "...",
  "appId": "..."
}
```

---

## 3. Building the Docker Image

Run the following command in the root directory (where the `Dockerfile` is located):

```bash
docker build -t sweep-cleaner .
```

---

## 4. Running the Container

### Standard Run (Cloud Mode)
To run the container using the cloud-based Gemini AI and local SQLite storage:

```bash
docker run -d \
  -p 3000:3000 \
  --name sweep-app \
  --env-file .env \
  -v sweep_data:/app/data \
  sweep-cleaner
```

*Note: The `-v sweep_data:/app/data` flag ensures your SQLite database (`sweep.db`) persists across container restarts.*

### Local Run (With Local LLM)
If you are running a local LLM (like Ollama) on your host machine:

1.  Ensure Ollama is running and accessible (e.g., `http://localhost:11434`).
2.  Run the container with host network access or use your host's IP:

```bash
docker run -d \
  -p 3000:3000 \
  --name sweep-app \
  --env-file .env \
  sweep-cleaner
```

3.  In the Sweep Web UI:
    *   Toggle **LOCAL RUN** to "On".
    *   Open **Settings** (gear icon).
    *   Set the **Local LLM Endpoint** (e.g., `http://host.docker.internal:11434/api/generate` for Mac/Windows).

---

## 5. Persistence & Volumes

The application stores its data in a SQLite file named `sweep.db`. To prevent data loss when the container is removed, it is highly recommended to mount a volume:

```bash
docker run -p 3000:3000 -v $(pwd)/sweep.db:/app/sweep.db sweep-cleaner
```

---

## 6. Troubleshooting

*   **OAuth Redirect Mismatch**: Ensure `http://localhost:3000` is added to your "Authorized redirect URIs" in the Google Cloud Console.
*   **Firebase Auth Errors**: Check that the domain where the app is hosted is added to the "Authorized domains" in the Firebase Authentication settings.
*   **Database Locked**: Ensure only one process is accessing the `sweep.db` file at a time.
