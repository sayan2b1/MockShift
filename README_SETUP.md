# MockShift Setup & Testing Guide

Welcome to **MockShift** (Bring Your Own Paper CBT Exam Simulator).

This guide walks you through:
1. Setting up **Google Sign-In & Google Drive PDF Upload** via Google Cloud Console.
2. Configuring your **Bring Your Own Key (BYOK) Gemini API Key** from Google AI Studio.
3. Running and testing MockShift locally on `http://127.0.0.1:8000`.

---

## 1. Google OAuth 2.0 & Drive API Setup (Google Cloud Console)

To enable Google Sign-In and direct PDF upload into the student's Google Drive (`MockShift Papers` folder):

### Step A: Create or Select a Project
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select an existing project or create a new one (e.g., `MockShift-Dev`).

### Step B: Enable Google Drive API
1. Navigate to **APIs & Services** > **Library**.
2. Search for **Google Drive API** and click **Enable**.

### Step C: Configure OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Choose **External** user type and click **Create**.
3. Fill in:
   - **App name**: `MockShift`
   - **User support email**: Your email
   - **Developer contact information**: Your email
4. In **Scopes**, add or ensure:
   - `https://www.googleapis.com/auth/drive.file` (Per-file access: allows MockShift to create/read only files created by MockShift).
5. In **Test users** (Critical while app is in "Testing" status):
   - Add your Google account email and any test user emails.

### Step D: Create OAuth 2.0 Web Client ID
1. Go to **APIs & Services** > **Credentials**.
2. Click **+ CREATE CREDENTIALS** > **OAuth client ID**.
3. Select **Application type**: **Web application**.
4. Set **Name**: `MockShift Web Client`.
5. Under **Authorized JavaScript origins**, add:
   - `http://localhost:8000`
   - `http://127.0.0.1:8000`
6. Click **Create** and copy your **Client ID** (it ends with `.apps.googleusercontent.com`).

### Step E: Paste Client ID into MockShift
Open `MockShift/frontend/config.js` and paste your Client ID:
```javascript
const MockShiftConfig = {
  APP_NAME: "MockShift",
  GOOGLE_CLIENT_ID: "YOUR_COPIED_CLIENT_ID.apps.googleusercontent.com",
  ...
};
```
*(Note: If you skip this step, MockShift continues to work smoothly in **Guest Mode** with full local test history!)*

---

## 2. Gemini API Key (BYOK) Setup

MockShift uses **`gemini-3.5-flash-lite`** for high-speed, token-efficient PDF question extraction and **`gemini-3.8-flash`** for lazy answer key solving, surgical mistake autopsy, and adaptive weakness drills.

### Step A: Get a Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click **Create API Key**.
3. Copy your key (`AIzaSy...`).

### Step B: Configure in MockShift
You have two flexible, zero-friction options:
1. **User BYOK (Recommended for students/users):**
   - Click the **API Key** button in the top navigation header inside MockShift.
   - Paste your key and click **Save Key** (stored strictly in your browser's `localStorage` and never logged or written to disk on the server).
   - Click **Test Key** to verify active quota with a single click.
2. **Server Environment Fallback (Optional for hosting/dev):**
   - In `MockShift/backend/`, copy `.env.example` to `.env`:
     ```bash
     cp MockShift/backend/.env.example MockShift/backend/.env
     ```
   - Set `GEMINI_API_KEY=AIzaSy...`

---

## 3. Running & Testing MockShift Locally

### Step A: Install Dependencies
```bash
# In your Python virtual environment (Python 3.10+):
pip install -r MockShift/backend/requirements.txt
```

### Step B: Start the Server
```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir MockShift/backend --reload
```

### Step C: Open in Browser
Visit:
```
http://127.0.0.1:8000
```

---

## 4. Feature Checklist & Verification

| Feature | How to Test | Expected Behavior |
| :--- | :--- | :--- |
| **0 API Call Demo Tests** | Click "12Q Benchmark Demo" on Upload screen | Instantly opens Pre-Exam Quick Editor with live KaTeX rendering without using any API tokens. |
| **Local PyMuPDF Extraction** | Drag and drop a text-based question paper PDF | Local fitz inspects clean selectable text and sends extracted text directly, avoiding vision tokens. |
| **Google Drive Upload** | Select "Google Drive Upload" tab and choose a PDF | Requests `drive.file` OAuth consent, creates `MockShift Papers` folder in user's Drive, uploads file, and passes it to parser. |
| **Google Sign-In** | Click User pill > "Sign In with Google" | Authenticates via Google Identity Services and switches active history to `mockshift_history_<sub_id>`. |
| **Guest Mode Fallback** | Test without signing in | Full exam hall, lockdown, stopwatch, and past records work under `mockshift_history_guest`. |
| **BYOK Header Flow** | Save key in "API Key" modal | Request header `X-Gemini-Api-Key` is passed directly to FastAPI and instantiates `genai.Client` per request. |
| **Exam-Hall Lockdown** | Switch tabs or press Alt+Tab during an active test | Triggers Focus Break warning toast and records incident in Focus Break log. |
| **TCS iON Calculator** | Click "Calculator" in header (CAT/GATE modes) | Mouse-only scientific calculator with postfix trig, log, memory, and deg/rad toggle. |
| **Lazy Batch Solving** | Submit test with unkeyed questions | Only attempted unkeyed questions are batched (10-15 chunk) to `gemini-3.8-flash`. |
| **Mistake Autopsy** | Click "AI Mistake Autopsy" on a wrong question | Surgical analysis with core concept, LaTeX formula, step-by-step solution, and trap breakdown. |
| **Weakness Drill** | Click "Start 5-Question Weakness Drill" on Analytics dashboard | Generates a targeted 10-minute mini-quiz addressing missed concepts and launches CBT. |
