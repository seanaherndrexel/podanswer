# PodAnswer

The podcast network where episodes answer the questions people search for. Live at https://podanswer.com.

## How it's built
- Node 22 + Express, server-rendered HTML (no framework), Postgres.
- `src/server.js` routes and SEO plumbing (sitemap, RSS, structured data, click tracking, dashboards, admin).
- `src/views.js` all page templates. `public/` CSS and assets.
- `src/seed.js` loads `data/seed/podcasts/*.json` and `data/seed/blog/*.md` on every deploy (idempotent).
- `src/ingest.js` refreshes episodes from every podcast's RSS feed (daily cron). Members get transcripts.
- `src/generate.js` writes new answer articles for member podcasts with the Anthropic API.

## Environment variables
| Key | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (required) |
| `ADMIN_KEY` | Secret for `/admin?key=...` |
| `SITE_URL` | `https://podanswer.com` |
| `CANONICAL_HOST` | `podanswer.com` (redirects onrender.com and www to it) |
| `CONTACT_EMAIL` | Shown on site |
| `GA_MEASUREMENT_ID` | Google Analytics 4 id (optional) |
| `GSC_VERIFICATION` | Google Search Console meta verification token (optional) |
| `LEAD_WEBHOOK_URL` | POSTs each signup as JSON, e.g. a Make.com webhook (optional) |
| `ANTHROPIC_API_KEY` | For `generate.js` |
| `OPENAI_API_KEY` | For Whisper transcription in `ingest.js` when a feed has no transcript |

## Adding a podcast by hand
Drop a JSON file in `data/seed/podcasts/` (see `data/seed/BRIEF.md` for the schema) and deploy. Or approve a lead in `/admin` and add its feed the same way.

## Making a podcast a paying member
In `/admin`, set its tier to `member` (or `studio`). Ingest will start storing transcripts, and `node src/generate.js <slug> 4` writes four articles for it.

## Local dev
```
export DATABASE_URL=postgres://localhost/podanswer ADMIN_KEY=dev
npm install && npm run build && npm start
```


## Accounts, billing and the production line

- `src/auth.js` accounts (bcrypt + signed session cookie). `/signup`, `/login`, `/account`.
- `src/billing.js` Stripe Checkout (hosted) and webhooks at `/webhooks/stripe`.
  A paid subscription sets the podcast to `member` and queues an onboarding job;
  every monthly renewal queues another.
- `src/pipeline.js` the run itself: feed ingest and transcription, real search-demand
  research via Google autocomplete, Claude matching queries to episodes, article
  written and published, share image generated.
- `src/images.js` a branded 1200x630 PNG per answer at `/img/answer/<slug>.png`,
  cached in Postgres, used as og:image and in schema.
- Job API (called by Make, secured with `JOB_SECRET`):
  `POST /api/jobs/create`, `POST /api/jobs/:id/run`, `GET /api/jobs/due`, `POST /api/jobs/monthly`.

### Extra environment variables
| Key | Purpose |
|---|---|
| `SESSION_SECRET` | signs login cookies |
| `JOB_SECRET` | shared secret for the job API |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | signing secret for /webhooks/stripe |
| `STRIPE_PRICE_GROWTH` | price id for the $149/mo plan |
| `STRIPE_PRICE_NETWORK` | price id for the $349/mo plan |
| `MAKE_JOB_WEBHOOK` | Make webhook that runs the job |
| `ANTHROPIC_API_KEY` | writes the articles |
