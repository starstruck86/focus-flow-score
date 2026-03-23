# Focus Flow Score

A **standalone sales coaching and decision-support app** for individual contributors. It provides real-time recommendations, pipeline intelligence, funnel gap analysis, and execution guidance — all without requiring external CRM or cadence tool integrations.

## What it does

- **Daily execution coaching** — recommends your next best action based on pipeline state, funnel gaps, and work context
- **Pipeline intelligence** — forecast modeling, bottleneck diagnosis, and quota pacing
- **Prospecting guidance** — ICP scoring, account prioritization, and outreach planning
- **Call coaching** — mock calls, objection drills, and transcript grading
- **Journal & accountability** — daily check-ins, streak tracking, and performance trends
- **Prep Hub** — meeting prep, content building, and resource management

## Integration status

This app is a **standalone system**. It does **not** currently integrate with:

- Salesforce
- Salesloft
- Outreach
- Outlook / Google Calendar (live sync)
- Any external CRM or cadence platform

Activity learning is based on **local actions and manual signals** (done / skipped / blocked / snoozed), not live CRM sync. Data can be imported via CSV.

## Tech stack

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Lovable Cloud (backend, auth, storage)
- Zustand (client state)

## Getting started

> **Package manager:** This project uses **npm** exclusively. Do not use bun, yarn, or pnpm.

```sh
# Clone the repository
git clone <YOUR_GIT_URL>

# Navigate to the project directory
cd <YOUR_PROJECT_NAME>

# Install dependencies
npm install

# Start the development server
npm run dev

# Other useful commands:
# npm run build        — production build
# npm run typecheck    — TypeScript check
# npm run test         — run tests
```

## Environment variables

This project uses Lovable Cloud, which auto-populates `.env` with backend credentials. If setting up locally:

1. Copy `.env.example` to `.env`:
   ```sh
   cp .env.example .env
   ```
2. Fill in the values (available from your Lovable Cloud project settings):
   - `VITE_SUPABASE_PROJECT_ID` — Your backend project ID
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — Your public/anon API key
   - `VITE_SUPABASE_URL` — Your backend API URL

> **Note:** These are publishable (client-safe) keys only. Private secrets are managed via Lovable Cloud's secrets manager and injected into backend functions at runtime.

## Deployment

Open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click Share → Publish.

## Custom domain

Navigate to Project > Settings > Domains and click Connect Domain. [More info](https://docs.lovable.dev/features/custom-domain#custom-domain).
