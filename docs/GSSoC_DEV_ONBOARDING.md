# GSSoC '26 Developer Onboarding Checklist & Setup Guide 🚀

Welcome to **HELPDESK.AI**! This guide provides a comprehensive walkthrough for GSSoC contributors to set up their local development environment, seed the database, and start contributing.

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

The backend handles AI triage, OCR, and sentiment analysis.

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
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
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

## 🗄️ Database Seeding

To have data to work with, you need to seed your database.

1. **Apply Migrations**:
   Copy the SQL from `supabase/migrations/` and run them in the Supabase SQL Editor.

2. **Run Seed Script**:
   Ensure your backend `.env` is configured, then:
   ```bash
   cd ../backend
   python scripts/seed_company_settings.py
   ```
   This will initialize system settings for existing tickets in your database.

---

## 🤝 Contribution Workflow

1. **Sync with Upstream**:
   ```bash
   git checkout gssoc
   git pull upstream gssoc
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
   Open a PR against the `gssoc` branch (Note: GSSoC PRs strictly target `gssoc`, not `main`).

---

## ✅ Onboarding Checklist
- [ ] Cloned repository and checked out the `gssoc` branch.
- [ ] Registered for test account at https://helpdeskaiv1.vercel.app/signup (Employee Signup under company **RITESH PVT LTD**).
- [ ] Assigned to issue prior to opening PR.
- [ ] Backend dependencies installed and running.
- [ ] Frontend dependencies installed and running.
- [ ] Supabase project configured and seeded.
- [ ] PR targets the `gssoc` branch.

Happy coding! If you run into issues, please reach out in the Discord community.
