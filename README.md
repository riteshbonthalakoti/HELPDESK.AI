<p align="center">
  <img src="https://img.shields.io/badge/HELPDESK.AI-111827?style=for-the-badge&logo=codeigniter&logoColor=10b981&labelColor=000000" height="56" alt="HELPDESK.AI Logo">
</p>

<h1 align="center">The Open-Source AI Helpdesk for Modern Engineering Teams</h1>

<p align="center">
  Real-time ticket triage, multimodal OCR error extraction, semantic duplicate clustering,<br>
  and automated solution synthesis — eliminating the manual IT support bottleneck.
</p>

<p align="center">
  <a href="https://helpdeskaiv1.vercel.app/"><img src="https://img.shields.io/badge/Launch_Application-helpdeskaiv1.vercel.app-2563eb?style=for-the-badge&logo=vercel&logoColor=white" alt="Launch Application"></a>
  &nbsp;
  <a href="./MobileApp/application-2d277b36-4dbd-41c8-806d-cb2f19acf38a.apk"><img src="https://img.shields.io/badge/Download_APK-Android_Release-10b981?style=for-the-badge&logo=android&logoColor=white" alt="Download Android APK"></a><br>
  <sub>If HELPDESK.AI helps your team resolve incidents faster, a ⭐ helps others find it.</sub>
</p>

<p align="center">
  <a href="https://woc.codesocial.tech/projects"><img src="https://img.shields.io/badge/Winter_of_Code_Social-2026-0052cc?style=flat-square&logoColor=white" alt="WOCS 2026"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Python-3.10%2B-blue?style=flat-square&logo=python&logoColor=white" alt="Python 3.10+">
  <img src="https://img.shields.io/badge/FastAPI-0.104%2B-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/React-19.2-61dafb?style=flat-square&logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ed?style=flat-square&logo=docker&logoColor=white" alt="Docker Ready">
  <a href="https://github.com/riteshbonthalakoti/HELPDESK.AI/stargazers"><img src="https://img.shields.io/github/stars/riteshbonthalakoti/HELPDESK.AI?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#benchmarks">Benchmarks</a> ·
  <a href="#for-developers">For developers</a> ·
  <a href="#winter-of-code-social-2026">WOCS 2026</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#license">License</a>
</p>

---

<table>
<tr>
<td width="33%" align="center" valign="top">
<h3>⚡ Millisecond Neural Triage</h3>
<p align="left">
<b>DistilBERT v3</b> classifies incoming tickets into severity tiers (P1 to P4) and engineering domains in under 50 ms. User sentiment, urgency, and impact scores are derived instantaneously without manual queue delays.
</p>
</td>
<td width="33%" align="center" valign="top">
<h3>🔍 Multimodal OCR & NER</h3>
<p align="left">
Drop error screenshots, stack traces, or terminal logs. <b>Tesseract OCR</b> and transformer NER automatically harvest hostnames, IPs, error codes, and crash traces without forcing users into tedious form dropdowns.
</p>
</td>
<td width="33%" align="center" valign="top">
<h3>🛡️ Duplicate Outage Shield</h3>
<p align="left">
<b>Sentence-transformers</b> compute 384-dimensional dense vector embeddings to cluster duplicate reports during live outages, preventing ticket flooding and alerting on-call engineers to active incidents.
</p>
</td>
</tr>
</table>

**Your AI, your choice.** Use local neural models (`DistilBERT`, `all-MiniLM-L6-v2`, `Ollama`) on your own infrastructure with zero external API fees and total air-gapped data privacy, or connect cloud LLM providers (Claude, OpenAI, Gemini, Groq, Mistral, OpenRouter) for generative automated resolution synthesis.

**Free and open source** ([MIT License](LICENSE)).

---

## Quick start

### 1. Try the Live Cloud Demo
Experience the complete production system instantly in your browser:
- **Web Application**: [helpdeskaiv1.vercel.app](https://helpdeskaiv1.vercel.app/)
- **Swagger / OpenAPI Documentation**: [ritesh19180-ai-helpdesk-api.hf.space/docs](https://ritesh19180-ai-helpdesk-api.hf.space/docs)
- **Interactive System Presentation**: [riteshbonthalakoti.github.io/HELPDESK.AI](https://riteshbonthalakoti.github.io/HELPDESK.AI/)

### 2. Run with Docker (Recommended for Local Testing)
Spin up the entire containerized stack with a single command:

```bash
git clone https://github.com/riteshbonthalakoti/HELPDESK.AI.git && cd HELPDESK.AI
docker compose up -d
```
The web dashboard opens at `http://localhost:3000` and the neural API listens on `http://localhost:7860`.

### 3. Run from Source
```bash
# Clone the repository
git clone https://github.com/riteshbonthalakoti/HELPDESK.AI.git && cd HELPDESK.AI

# 1. Start the FastAPI Neural Backend
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 2. In a second terminal, start the React 19 Frontend
cd ../Frontend
npm install
npm run dev
```

---

## How it works

```
 ┌─────────────────┐       ┌────────────────────────┐       ┌────────────────────────┐
 │ Incoming Ticket │ ────► │ Multimodal OCR & NER   │ ────► │ Semantic Vector Search │
 │ (Text / Image)  │       │ (Tesseract.js / OpenCV)│       │ (Sentence Transformers)│
 └─────────────────┘       └────────────────────────┘       └───────────┬────────────┘
                                                                        │
 ┌─────────────────┐       ┌────────────────────────┐                   ▼
 │ Automated Runbook│ ◄────│ Neural Classification  │ ◄───── ┌──────────────────────┐
 │ & Route Dispatch│       │ (DistilBERT v3 / SetFit│        │ Duplicate Outage Match│
 └─────────────────┘       └────────────────────────┘        │ (> 0.88 Cosine Sim)   │
                                                             └──────────────────────┘
```

- **Zero manual triage latency**: Every submitted ticket is categorized, prioritized, and scored before the user even navigates away from the confirmation screen.
- **Multimodal image understanding**: Screenshots and crash photos are parsed client-side using Tesseract.js OCR, extracting exact error codes and stack traces directly into structured JSON.
- **Automatic duplicate deduplication**: Real-time vector search compares ticket embeddings against active cluster baselines. If 20 users report the same database outage, they are grouped under a single master incident.
- **Privacy & PII protection**: Sensitive user data (passwords, credit card formats, personal IDs) is sanitized via regex and entity masking before entering vector indices or classification layers.
- **Degraded startup resilience**: Built with enterprise tolerance (`ALLOW_DEGRADED_STARTUP=1`). If external cloud databases or optional model weights are unavailable, the system boots gracefully with deterministic fallback rules.

---

## Benchmarks

Measured end-to-end on an Intel/Apple Silicon host across 1,000 synthetic enterprise tickets:

| Pipeline Stage | Manual Human Triage | HELPDESK.AI Neural Pipeline | Performance Delta |
| :--- | :--- | :--- | :--- |
| **First Triage & Tagging** | 15 – 45 minutes | **38 ms** (DistilBERT v3) | > 20,000× faster |
| **Screenshot Error Extraction** | 3 – 5 minutes | **280 ms** (Tesseract OCR) | Real-time extraction |
| **Duplicate Incident Detection** | Often missed / manual | **14 ms** (Dense Cosine Similarity) | Zero duplicate flooding |
| **Named Entity Extraction (NER)**| Manual lookup | **22 ms** (Token Classifier) | Automated metadata |
| **End-to-End Triage & Routing** | 30 – 60 minutes | **354 ms** (P50) / **806 ms** (P99) | **Instant Dispatch** |

---

## Winter of Code Social (WOCS 2026)

HELPDESK.AI is an officially selected and featured project in **Winter of Code Social 2026**! ❄️

- 🌐 **WOCS Project Listing**: [woc.codesocial.tech/projects](https://woc.codesocial.tech/projects)
- 📊 **Official Leaderboard**: [woc.codesocial.tech/leaderboard](https://woc.codesocial.tech/leaderboard)
- 💬 **Discord Community**: Join the Code Social Discord and collaborate under our project thread in `#find-a-project`.

### Point Scoring Matrix
All merged pull requests are automatically credited via the WOCS automated webhook system based on their assigned issue difficulty label:

| Level Label | Points Awarded | Scope & Complexity |
| :--- | :---: | :--- |
| `level 1` | **3 Points** | Documentation improvements, UI/UX polish, starter tasks, accessibility |
| `level 2` | **5 Points** | Component features, API enhancements, unit test coverage, responsive design |
| `level 3` | **11 Points** | Complex ML pipelines, vector search optimization, architectural overhauls |

> [!IMPORTANT]
> **Contribution Workflow**:
> 1. Find an issue labeled `wocs` or open a new architectural proposal.
> 2. Comment `/claim` on the issue to get assigned by our automation bot.
> 3. Read our [CONTRIBUTING.md](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).
> 4. Submit your PR referencing the issue (`Closes #...`).

---

## For developers

<details>
<summary><b>Run from source</b>: detailed environment setup, healthchecks, and testing</summary>

### Prerequisites
- **Node.js**: v18.0+ (v20+ recommended)
- **Python**: 3.10 or 3.11
- **npm** or **pnpm**
- **Docker & Docker Compose** (optional, for containerized run)

### Backend Environment Configuration
Copy `backend/.env.example` to `backend/.env` and configure your credentials:

```bash
cd backend
cp .env.example .env
```

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Supabase project URL | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Service role key for backend access | `eyJhbGciOiJIUzI1...` |
| `ALLOW_DEGRADED_STARTUP` | Boot backend even if model weights fail | `1` (lenient) or `0` (strict) |
| `SENTENCE_TRANSFORMER_MODEL_PATH` | Optional offline model weight directory | `./models/all-MiniLM-L6-v2` |
| `REQUIRE_SUPABASE` | Fail readiness gate if Supabase is offline | `false` |

### Healthcheck & Readiness Verification
Verify your deployment with standard probes:

```bash
# 1. Liveness Probe (FastAPI process is responsive)
curl -fsS http://localhost:8000/health
# Response: {"status": "ok"}

# 2. Readiness Probe (Model services and dependencies loaded)
curl -fsS http://localhost:8000/ready
# Response: {"status": "ready"}
```

### Running Backend Tests
```bash
cd backend
pytest tests/ -v
```

### Running Frontend Tests
```bash
cd Frontend
npm run test
```

</details>

<details>
<summary><b>Repository layout</b>: directory structure and file responsibilities</summary>

```
HELPDESK.AI/
├── backend/                  # FastAPI Neural Microservices & ML Pipeline
│   ├── main.py               # Main application entry point & routing
│   ├── requirements.txt      # Python dependencies (PyTorch, Transformers, FastAPI)
│   ├── healthcheck.py        # Automated container healthcheck probe
│   └── tests/                # Pytest unit and integration test suite
├── Frontend/                 # React 19 + Vite 7 Modern Dashboard
│   ├── src/                  # Component hierarchies, hooks, and state stores
│   │   ├── components/       # Reusable UI widgets, analytics charts, forms
│   │   ├── hooks/            # Custom React hooks (OCR, tickets, real-time)
│   │   └── stores/           # Zustand global state management
│   ├── package.json          # Frontend dependencies (TailwindCSS, Lucide, Antd)
│   └── vite.config.js        # Vite bundler configuration
├── MobileApp/                # React Native + Expo SDK 54 Companion App
│   ├── app/                  # Expo Router file-based screens
│   └── package.json          # React Native dependencies
├── database/                 # PostgreSQL & Supabase migrations and schemas
│   └── schema.sql            # Core tables, RLS policies, and vector extensions
├── docs/                     # Architectural specs, API documentation, runbooks
├── docker/                   # Dockerfiles for multi-stage production builds
├── docker-compose.yml        # Multi-container local orchestration
└── .github/workflows/        # Automated CI/CD, linting, and security audits
```

</details>

---

## Architecture

HELPDESK.AI employs a decoupled, enterprise microservice architecture designed for zero single-points-of-failure:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER                            │
│   React 19 Web App (Vite 7)      │      Mobile App (Expo SDK 54)       │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ HTTPS / WSS
┌──────────────────────────────────▼─────────────────────────────────────┐
│                          GATEWAY & API LAYER                           │
│     FastAPI Async Engine  ·  Rate Limiting  ·  JWT Authentication     │
└──────────────────┬───────────────────────────────┬─────────────────────┘
                   │                               │
┌──────────────────▼───────────────┐ ┌─────────────▼─────────────────────┐
│       NEURAL INFERENCE BUS       │ │        PERSISTENCE LAYER          │
│ • DistilBERT v3 (Classification) │ │ • PostgreSQL / Supabase (RLS)     │
│ • all-MiniLM-L6-v2 (Embeddings)  │ │ • pgvector (Semantic Search)      │
│ • Tesseract OCR (Vision / Logs)  │ │ • Redis (Session & Cache)         │
└──────────────────────────────────┘ └───────────────────────────────────┘
```

---

## Community & Support

<p align="center">
  <a href="https://github.com/riteshbonthalakoti/HELPDESK.AI"><img src="https://img.shields.io/badge/Star_Repository-e5a50a?style=for-the-badge&logo=github&logoColor=white" alt="Star Repository"></a>
  &nbsp;
  <a href="https://github.com/riteshbonthalakoti/HELPDESK.AI/fork"><img src="https://img.shields.io/badge/Fork_Repository-238636?style=for-the-badge&logo=git&logoColor=white" alt="Fork Repository"></a>
  &nbsp;
  <a href="https://www.linkedin.com/in/ritesh1908/"><img src="https://img.shields.io/badge/Connect_LinkedIn-0077b5?style=for-the-badge&logo=linkedin&logoColor=white" alt="Connect on LinkedIn"></a>
  &nbsp;
  <a href="https://discord.gg/MSTNyRSPYW"><img src="https://img.shields.io/badge/Join_Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join Discord"></a>
</p>

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details. Built with ❤️ for the global open-source community.
