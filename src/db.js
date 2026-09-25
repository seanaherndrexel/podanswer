// Database layer. Postgres in production (DATABASE_URL).
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) console.error('DATABASE_URL is not set');
const pool = new Pool({
  connectionString,
  ssl: connectionString && /render\.com|amazonaws|neon|supabase/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  stripe_customer_id TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS podcasts (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  description TEXT,
  category TEXT NOT NULL,
  website TEXT,
  feed_url TEXT,
  image_url TEXT,
  apple_url TEXT,
  spotify_url TEXT,
  youtube_url TEXT,
  tier TEXT NOT NULL DEFAULT 'listed',   -- listed | member | studio
  featured BOOLEAN NOT NULL DEFAULT false,
  dashboard_token TEXT UNIQUE,
  owner_email TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS episodes (
  id SERIAL PRIMARY KEY,
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at DATE,
  summary TEXT,
  audio_url TEXT,
  duration_sec INTEGER,
  episode_url TEXT,
  transcript_url TEXT,
  transcript TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (podcast_id, guid),
  UNIQUE (podcast_id, slug)
);
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  slug TEXT UNIQUE NOT NULL,
  question TEXT NOT NULL,
  meta_description TEXT,
  body JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS article_images (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  png BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS blog_images (
  slug TEXT PRIMARY KEY,
  png BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  podcast_id INTEGER REFERENCES podcasts(id) ON DELETE SET NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  plan TEXT NOT NULL,                    -- growth | network
  quota INTEGER NOT NULL DEFAULT 4,      -- articles per month
  status TEXT NOT NULL DEFAULT 'pending',-- pending | active | past_due | canceled
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  podcast_id INTEGER REFERENCES podcasts(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                    -- onboard | monthly
  quota INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  detail TEXT,
  articles_written INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS clicks (
  id SERIAL PRIMARY KEY,
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  referrer TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pageviews (
  id SERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  podcast_id INTEGER REFERENCES podcasts(id) ON DELETE CASCADE,
  article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
  referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name TEXT, email TEXT NOT NULL, podcast_name TEXT, feed_url TEXT,
  plan TEXT, message TEXT, source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS blog_posts (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, meta_description TEXT, body_md TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS article_orders (
  id SERIAL PRIMARY KEY,
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'new',          -- new | rewrite
  status TEXT NOT NULL DEFAULT 'queued',     -- awaiting_payment | queued | researching | writing | done | failed
  target_query TEXT,
  note TEXT,
  detail TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT,
  billing_period DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_podcast ON article_orders(podcast_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON article_orders(status, created_at);
CREATE TABLE IF NOT EXISTS gsc_rows (
  id SERIAL PRIMARY KEY,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  page TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  position NUMERIC(6,2),
  podcast_id INTEGER REFERENCES podcasts(id) ON DELETE CASCADE,
  article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_start, page, query)
);
CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  podcast_id INTEGER REFERENCES podcasts(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT,
  period_start DATE,
  provider_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gsc_podcast ON gsc_rows(podcast_id, period_start);
CREATE INDEX IF NOT EXISTS idx_gsc_period ON gsc_rows(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_emails_kind ON emails(kind, period_start);
CREATE INDEX IF NOT EXISTS idx_articles_podcast ON articles(podcast_id);
CREATE INDEX IF NOT EXISTS idx_episodes_podcast ON episodes(podcast_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_clicks_podcast ON clicks(podcast_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_podcast ON pageviews(podcast_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_article ON pageviews(article_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
`;

async function migrate() {
  await pool.query(SCHEMA);
  for (const sql of [
    `ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS youtube_url TEXT`,
    `ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS owner_email TEXT`,
    `ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS report_opt_out BOOLEAN NOT NULL DEFAULT false`,
    `CREATE TABLE IF NOT EXISTS suggestions (
      id SERIAL PRIMARY KEY,
      podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      focus_keyword TEXT,
      est_monthly_searches INTEGER,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS suggestions_ep ON suggestions(episode_id, status)`,
    `ALTER TABLE article_orders ADD COLUMN IF NOT EXISTS suggestion_id INTEGER`,
    `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS transcript_source TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_ip TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS checkout_terms_at TIMESTAMPTZ`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ`,
    `ALTER TABLE articles ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ`,
    `ALTER TABLE articles ADD COLUMN IF NOT EXISTS rewrites INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE articles ADD COLUMN IF NOT EXISTS order_id INTEGER`,
  ]) { try { await pool.query(sql); } catch (e) { console.warn('migrate note:', e.message); } }
}

const q = (text, params) => pool.query(text, params);
module.exports = { pool, q, migrate };

if (require.main === module && process.argv[2] === 'migrate') {
  migrate().then(() => { console.log('migrated'); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
}
