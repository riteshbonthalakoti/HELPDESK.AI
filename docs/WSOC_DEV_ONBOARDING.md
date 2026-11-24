# WSOC 2026 Developer Onboarding Checklist & Setup Guide 🚀

Welcome to **HELPDESK.AI**! This guide provides a walkthrough for **WSOC 2026 (Winter of Code Social)** contributors to set up their local development environment, test the web/mobile apps, and submit clean pull requests.

---

## 📋 Prerequisites

Ensure you have the following installed on your system:
- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **Python**: v3.10 or higher
- **Git**: Latest version
- **Supabase Account**: For local/cloud database instance

---

## 🛠️ Initial Setup

1. **Fork the Repository**:
   Click the "Fork" button on the top right of the [HELPDESK.AI repository](https://github.com/riteshbonthalakoti/HELPDESK.AI).

2. **Clone your Fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/HELPDESK.AI.git
   cd HELPDESK.AI
   ```

3. **Set Up Remote**:
   ```bash
   git remote add upstream https://github.com/riteshbonthalakoti/HELPDESK.AI.git
   ```

---

## ⚙️ Backend Setup (Python/FastAPI)

The backend handles AI triage, OCR, email OTP verification, and sentiment analysis.

1. **Navigate to Backend**:
   ```bash
   cd backend
   ```

2. **Create a Virtual Environment**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Environment Variables**:
   Create a `.env` file in the `backend/` directory:
   ```text
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_SERVICE_KEY=your_supabase_service_role_key
   ```

5. **Run the Backend**:
   ```bash
   uvicorn main:app --reload --port 7860
   ```
   The API will be available at `http://localhost:7860/docs`.

---

## 🎨 Frontend Setup (React/Vite)

1. **Navigate to Frontend**:
   ```bash
   cd ../Frontend
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Environment Variables**:
   Create a `.env` file in the `Frontend/` directory:
   ```text
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Run the Frontend**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

## 📱 Android Mobile App (APK) Setup

If you are contributing to the Android APK under `MobileApp/` (Expo SDK 54 / React Native), see [MobileApp/README.md](../MobileApp/README.md) for local setup, Emulator/Expo Go testing, and Gradle/EAS APK builds.

---

## 🤝 Contribution Workflow

1. **Sync with Upstream**:
   ```bash
   git checkout main
   git pull upstream main
   ```

2. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/issue-123-your-feature-name
   ```

3. **Commit Changes**:
   Follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat: add new triage signal`).

4. **Push and Open PR**:
   ```bash
   git push origin feature/issue-123-your-feature-name
   ```
   Open a PR against the `main` branch.

---

## ✅ WSOC 2026 Onboarding Checklist
- [ ] Cloned repository from the `main` branch.
- [ ] Registered for an employee test account at https://helpdeskai1918.vercel.app/signup under company **RITESH PVT LTD**.
- [ ] Assigned to issue prior to opening PR.
- [ ] PR targets the `main` branch.

Happy coding!
