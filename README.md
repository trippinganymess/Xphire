# ⚡ Xphire AI — Job Scout Terminal

> An automated AI-powered job scout and digest delivery pipeline that scrapes 850+ ATS endpoints and job portals, enriches listings with Gemini AI, and dispatches retro-styled email digests on-demand or on a 6-hour schedule.

[![Live Application](https://img.shields.io/badge/Live_Application-Open_Xphire-7C3AED?style=for-the-badge)](https://xphire.animesh-23gcebds018.workers.dev/#/)

**Live deployment:** [xphire.animesh-23gcebds018.workers.dev](https://xphire.animesh-23gcebds018.workers.dev/#/)

---

## 🚀 Features

- **850+ ATS & Portal Scraping**: Direct API integrations with Greenhouse, Lever, Ashby, and SmartRecruiters alongside Google Jobs, LinkedIn, and Indeed.
- **Gemini AI Enrichment**: Real-time evaluation of job postings with 1–5★ company scoring, experience categorization, and salary extraction.
- **Live Job Board**: Browse recently scraped opportunities in a responsive card-based feed with keyword search, minimum-rating filters, and a freshers-only view.
- **Hybrid Backfill Pipeline**: Combines fresh live scrapes with top-rated Supabase cached records to guarantee full, high-quality digests.
- **Neo-Brutalist / Retro Terminal UI**: Interactive sketch terminal interface for search configuration, user profiles, and schedule management.
- **Automated 6-Hour Cron**: Background GitHub Actions workflows dispatching scheduled digests directly to subscriber inboxes.
- **Deduplication Vault**: SHA-256 job hashing in Supabase prevents duplicate listings across runs.

---

## 📋 Live Job Board

The application opens directly to the Job Board, which turns the scraping and AI-enrichment pipeline into a browsable feed of current opportunities.

- Displays jobs scraped during the last 24 hours, ordered newest first.
- Shows company, role, location, experience, salary, source, relative posting time, and Gemini-generated company rating.
- Supports keyword searches across company, title, and location.
- Filters opportunities by minimum star rating or fresher-friendly experience requirements.
- Refreshes automatically every 60 seconds as new pipeline results arrive in Supabase.
- Links directly to the original job posting through each **Apply Now** button.
- Uses the same neo-brutalist visual system as the search terminal and authentication experience.

Try it here: **[Open the Xphire Job Board](https://xphire.animesh-23gcebds018.workers.dev/#/)**

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Vanilla CSS *(Cloudflare Workers Assets)*
- **Backend**: Python 3.11, Asyncio, HTTPX, JobSpy, Google GenAI SDK
- **Database & Auth**: Supabase (PostgreSQL, Auth, Edge Functions, RLS)
- **Automation**: GitHub Actions Workflows (on-demand dispatch & recurring cron)
- **Delivery**: SMTP TLS / SSL email generator

---

## 💻 Terminal Commands

| Command | Description |
| :--- | :--- |
| `run` | Configure and trigger a one-time on-demand job scout run |
| `schedule` | Set up a recurring 6-hour email digest with custom IST time slot |
| `unschedule` | Cancel your active recurring email subscription |
| `status` | View pipeline connectivity and system status |
| `whoami` | Display active authenticated user profile |
| `clear` | Clear the terminal window |
| `help` | Show available commands |
