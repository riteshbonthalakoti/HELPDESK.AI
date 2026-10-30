# Contributing to HELPDESK.AI 🚀

First off, thank you for considering contributing to **HELPDESK.AI**! It's contributors like you who help transform IT support from "Chaos to Clarity."

---

## 🏛️ Founding Team (Infosys Springboard - Group 2)

HELPDESK.AI was conceived and built during the **Infosys Springboard Virtual Internship 6.0**. We acknowledge the foundational work of the following team members:

### 👥 Leadership & Coordination
*   **Duniya Vasa** (Group Lead)
*   **Sowjanya N**

### 🧠 AI & Modeling
*   **Pragati Tiwari** (Lead)
*   **Shaik Eshak**
*   **Ippili Raju**
*   **Vinitha Giri**
*   **Asna Abdul Kareem**
*   **Ritesh Bonthalakoti**

### ⚙️ Backend Engineering
*   **Asmeet Kaur Makkad** (Lead)
*   **Vijayalakshmi S R**
*   **Dinesh Reddy Vasampelli**
*   **Manya Sahasra**

### 🎨 Frontend Engineering
*   **Satla Prayukthika** (Lead)
*   **Bandi Keerthi Krishna**
*   **Shubha G D**
*   **Phani Kotha**

### 📊 Data Engineering
*   **Praneetha Baru** (Lead)
*   **Kavin Sarvesh**
*   **Utukuri Naga Sri Hari Chandana**
*   **Akash Kumar Paswan**
*   **Ganesh Goud Tekmul**

---

## 🌟 GirlScript Summer of Code (GSSoC 2026) Guidelines

We are proudly participating in **GSSoC 2026**! To ensure seamless collaboration, automated point tracking, and fair evaluation, all contributors must strictly adhere to the following workflow:

### 🚨 1. Target Branch Requirement (CRITICAL)
*   **ALL Pull Requests MUST target the `gssoc` branch, NOT `main`!**
*   The `main` branch is our production release branch and is strictly protected.
*   Any PR opened against `main` will be automatically rejected or requested to be re-targeted.
*   When cloning and branching, always branch off `gssoc`:
    ```bash
    git clone --branch gssoc --single-branch https://github.com/riteshbonthalakoti/HELPDESK.AI.git
    cd HELPDESK.AI
    git checkout -b fix/issue-123-short-description
    ```

### 🎯 2. Issue Assignment Workflow
*   **Do not start work without prior assignment.** Unassigned PRs will be closed without review.
*   Find an open issue with the label `gssoc` or `gssoc:approved`.
*   Comment on the issue: `@riteshbonthalakoti please assign this to me under GSSoC 2026.` Include a concise 2-sentence implementation plan.
*   Issues are assigned chronologically to the first contributor who provides a solid plan.
*   **One issue per PR.** Do not bundle multiple unrelated features or bug fixes into a single pull request.

### 🏆 3. Scoring Formula & Review Matrix
Points are credited upon PR merge based on our standardized scoring rubric:

$$\text{PR Score} = 50 + (\text{Difficulty Pts} \times \text{Quality Multiplier}) + \text{Type Bonus}$$

| Difficulty Label | Points | Quality Multiplier | Value | Type Bonus Label | Points |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `level:beginner` | 20 pts | `quality:clean` | ×1.2 | `type:docs` | +5 pts |
| `level:intermediate` | 35 pts | `quality:exceptional` | ×1.5 | `type:testing` / `design` / `refactor` / `bug` / `feature` | +10 pts |
| `level:advanced` | 55 pts | | | `type:accessibility` / `performance` / `devops` | +15 pts |
| `level:critical` | 80 pts | | | `type:security` | +20 pts |

### ⏱️ 5. Review SLA & Quality Expectations
*   Maintainers review PRs within 24–48 hours.
*   Contributors must address requested review changes within **72 hours**, or the PR may be closed to unblock other contributors.
*   **Code Standards**:
    - **Meaningful Scope**: Aim for 200+ meaningful lines of code (including unit tests, edge-case checks, and error handling).
    - **No Debug Code**: Remove all `console.log`, temporary `print()` statements, and commented-out code blocks.
    - **No AI Attribution**: Contributors must own their work; do not include AI generator signatures or co-authorship tags.
    - **Test Coverage**: All existing and new unit tests must pass locally before opening your PR.

---

## 🌿 Branching Strategy & Naming Conventions

Always create a new branch from `gssoc` using descriptive prefixes:

```bash
git checkout gssoc
git pull upstream gssoc
git checkout -b <prefix>/issue-<number>-<description>
```

| Type | Branch Pattern | Example |
| :--- | :--- | :--- |
| Bug Fix | `fix/issue-<number>-<desc>` | `fix/issue-3949-sse-memory-leak` |
| Feature | `feat/issue-<number>-<desc>` | `feat/issue-3913-websocket-chat` |
| Security | `security/issue-<number>-<desc>` | `security/issue-3950-rate-limiter` |
| Performance | `perf/issue-<number>-<desc>` | `perf/issue-3978-pagination` |
| Testing | `test/issue-<number>-<desc>` | `test/issue-3914-cypress-suite` |
| Documentation | `docs/issue-<number>-<desc>` | `docs/issue-4040-fix-readme-links` |

---

## 🐳 Local Development Setup

### Option A: Docker Compose (Recommended)
Docker is the fastest way to get the entire microservice architecture running locally:

```bash
# Clone directly onto the gssoc branch
git clone --branch gssoc --single-branch https://github.com/riteshbonthalakoti/HELPDESK.AI.git
cd HELPDESK.AI

# Launch the unified stack (Frontend, Backend, PostgreSQL pgvector, Redis)
docker-compose -f docker-compose.local.yml up --build
```

- Frontend available at: `http://localhost:5173`
- Backend API Docs available at: `http://localhost:7860/docs`

---

### Option B: Manual Setup

#### 1. Backend (FastAPI / Python 3.10+)
```bash
cd backend

# Create and activate virtual environment
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Fill in your SUPABASE_URL, SUPABASE_SERVICE_KEY, and GEMINI_API_KEY

# Run backend development server
uvicorn main:app --reload --port 7860
```

#### 2. Frontend (React 19 / Vite 7)
```bash
cd Frontend

# Install packages
npm install

# Configure environment
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# Start Vite dev server
npm run dev
```

#### 3. Mobile App (React Native / Expo 54)
```bash
cd MobileApp
npm install
npx expo start
```

---

## 🛠️ Code Style & Verification

### Python (Backend)
- Adhere strictly to **PEP 8**.
- Use type hints for all function signatures.
- Keep ML model inference latency **strictly under 500ms**.
- Verify formatting and linting:
  ```bash
  cd backend
  ruff check .
  pytest
  ```

### JavaScript / React (Frontend)
- Functional components with React hooks.
- State management strictly managed via **Zustand**.
- Responsive UI styling built on **TailwindCSS** + **Framer Motion** adhering to the "Chaos to Clarity" design system.
- Verify formatting and linting:
  ```bash
  cd Frontend
  npm run lint
  npm run build
  ```

---

## 📬 Pull Request Submission Process

1.  **DCO Sign-Off**: Sign off your commits using `git commit -s -m "type: descriptive message"`.
2.  **Verify Branch**: Double-check that your PR compares your feature branch against `riteshbonthalakoti:gssoc`.
3.  **Fill the PR Template**: Detail the root cause, changes made, issue fixed (`Fixes #<number>`), and testing screenshots.
5.  **Monitor CI**: Ensure all GitHub Actions checks pass green before requesting maintainer review.

---

## 📚 Helpful Resources
- [README.md](README.md) - Project overview & system presentation
- [PLATFORM_MAP.md](PLATFORM_MAP.md) - Application page map & feature matrix
- [LOCAL_SETUP.md](LOCAL_SETUP.md) - Comprehensive local environment guide
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - Community standards
- [MENTORSHIP.md](MENTORSHIP.md) - Maintainer review rubric & point allocation guide
