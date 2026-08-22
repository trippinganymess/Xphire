# ⚡ Xphire AI — Job Scout Terminal

> An automated AI-powered job scout and digest delivery pipeline that scrapes 850+ ATS endpoints and job portals, enriches listings with Gemini AI, and dispatches retro-styled email digests on-demand or on a 6-hour schedule.

---

## 🚀 Features

- **850+ ATS & Portal Scraping**: Direct API integrations with Greenhouse, Lever, Ashby, and SmartRecruiters alongside Google Jobs, LinkedIn, and Indeed.
- **Gemini AI Enrichment**: Real-time evaluation of job postings with 1–5★ company scoring, experience categorization, and salary extraction.
- **Hybrid Backfill Pipeline**: Combines fresh live scrapes with top-rated Supabase cached records to guarantee full, high-quality digests.
- **Neo-Brutalist / Retro Terminal UI**: Interactive sketch terminal interface for search configuration, user profiles, and schedule management.
- **Automated 6-Hour Cron**: Background GitHub Actions workflows dispatching scheduled digests directly to subscriber inboxes.
- **Deduplication Vault**: SHA-256 job hashing in Supabase prevents duplicate listings across runs.

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

---

## 📄 License
MIT © [trippinganymess](https://github.com/trippinganymess)
