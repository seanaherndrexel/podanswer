const express = require('express');
const path = require('path');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { q, migrate } = require('./db');
const V = require('./views');
const { CATEGORIES, esc, slugify } = require('./util');
const auth = require('./auth');
const billing = require('./billing');
const { articleImage, blogImage } = require('./images');

const reports = require('./reports');
const mail = require('./mail');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const type = await billing.handleWebhook(req.body, req.get('stripe-signature'));
    console.log('stripe webhook', type);
    res.json({ received: true });
  } catch (e) {
    console.error('stripe webhook failed', e.message);
    res.status(400).send(`Webhook Error: ${e.message}`);
  }
});
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use((req, res, next) => auth.attachUser(req, res, next));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '365d', immutable: true }));

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const PAGE = 24;

// canonical host + https
const CANONICAL_HOST = process.env.CANONICAL_HOST || 'podanswer.com';
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (CANONICAL_HOST && host && host !== CANONICAL_HOST && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  }
  // one URL per page: strip trailing slashes so /answers/ does not duplicate /answers
  if (req.method === 'GET' && req.path.length > 1 && req.path.endsWith('/')) {
    const qs = req.originalUrl.slice(req.path.length);
    return res.redirect(301, req.path.replace(/\/+$/, '') + qs);
  }
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const isBot = (ua = '') => /bot|crawl|spider|slurp|facebookexternalhit|preview|fetch|monitor|headless/i.test(ua);

async function logView(req, { podcastId, articleId }) {
  if (isBot(req.get('user-agent'))) return;
  q(`INSERT INTO pageviews (path, podcast_id, article_id, referrer) VALUES ($1,$2,$3,$4)`,
    [req.path.slice(0, 300), podcastId || null, articleId || null, (req.get('referer') || '').slice(0, 300)]).catch(() => {});
}

const ARTICLE_SELECT = `SELECT a.id, a.slug, a.question, a.meta_description, a.published_at, a.updated_at, a.body, a.episode_id,
  p.slug AS podcast_slug, p.title AS podcast_title, p.image_url, p.category, p.author, p.tier
  FROM articles a JOIN podcasts p ON p.id = a.podcast_id WHERE a.status='published'`;

/* ---------- home ---------- */
app.get('/', wrap(async (req, res) => {
  const [stats, feat, pods, counts] = await Promise.all([
    q(`SELECT (SELECT count(*) FROM articles WHERE status='published') AS articles, (SELECT count(*) FROM podcasts) AS podcasts, (SELECT count(*) FROM episodes) AS episodes`),
    q(`${ARTICLE_SELECT} ORDER BY (p.tier <> 'listed') DESC, a.published_at DESC LIMIT 6`),
    q(`SELECT p.* FROM podcasts p ORDER BY p.featured DESC, (p.tier <> 'listed') DESC, p.updated_at DESC LIMIT 8`),
    q(`SELECT category, count(*)::int AS n FROM podcasts GROUP BY category`),
  ]);
  const s = stats.rows[0];
  res.send(V.home({
    stats: { articles: +s.articles, podcasts: +s.podcasts, episodes: +s.episodes },
    featuredArticles: feat.rows, featuredPodcasts: pods.rows,
    counts: Object.fromEntries(counts.rows.map((r) => [r.category, r.n])),
  }));
}));

/* ---------- answers ---------- */
async function renderAnswers(req, res, category) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const query = (req.query.q || '').toString().trim().slice(0, 120);
  const params = [];
  let where = '';
  if (category) { params.push(category); where += ` AND p.category = $${params.length}`; }
  if (query) { params.push(`%${query}%`); where += ` AND (a.question ILIKE $${params.length} OR a.meta_description ILIKE $${params.length} OR p.title ILIKE $${params.length})`; }
  params.push(PAGE + 1, (page - 1) * PAGE);
  const r = await q(`${ARTICLE_SELECT} ${where} ORDER BY a.published_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const hasMore = r.rows.length > PAGE;
  res.send(V.answersIndex({ articles: r.rows.slice(0, PAGE), category, query, page, hasMore }));
}
app.get('/topics', wrap(async (req, res) => {
  const [counts, popular] = await Promise.all([
    q(`SELECT category, count(*)::int AS n FROM podcasts GROUP BY category`),
    q(`${ARTICLE_SELECT} ORDER BY a.published_at DESC LIMIT 6`),
  ]);
  res.send(V.topicsPage({ counts: Object.fromEntries(counts.rows.map((r) => [r.category, r.n])), popular: popular.rows }));
}));
app.get('/answers', wrap((req, res) => renderAnswers(req, res, null)));
// Old category URLs fold into the topic silo so only one page competes per subject.
app.get('/categories/:cat', (req, res) => res.redirect(301, `/topics/${req.params.cat}`));

app.get('/topics/:topic', wrap(async (req, res) => {
  const topic = req.params.topic;
  const cat = CATEGORIES[topic];
  if (!cat) return res.status(404).send(V.notFound());
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const [arts, pods, count] = await Promise.all([
    q(`${ARTICLE_SELECT} AND p.category=$1 ORDER BY a.published_at DESC LIMIT $2 OFFSET $3`, [topic, PAGE + 1, (page - 1) * PAGE]),
    q(`SELECT * FROM podcasts WHERE category=$1 ORDER BY (tier <> 'listed') DESC, featured DESC, title LIMIT 8`, [topic]),
    q(`SELECT count(*)::int AS n FROM articles a JOIN podcasts p ON p.id=a.podcast_id WHERE p.category=$1 AND a.status='published'`, [topic]),
  ]);
  res.set('Cache-Control', 'public, max-age=300');
  res.send(V.topicHub({
    topic, cat,
    articles: arts.rows.slice(0, PAGE), hasMore: arts.rows.length > PAGE, page,
    podcasts: pods.rows, total: count.rows[0].n,
    siblings: Object.entries(CATEGORIES).filter(([k]) => k !== topic),
  }));
}));

app.get('/answers/:slug', wrap(async (req, res) => {
  const r = await q(`${ARTICLE_SELECT} AND a.slug = $1`, [req.params.slug]);
  if (!r.rows.length) {
    // An article the podcaster took down is gone on purpose. 410 tells Google to
    // drop it rather than keep checking back the way it would on a 404.
    const gone = (await q(`SELECT 1 FROM articles WHERE slug=$1 AND status='removed'`, [req.params.slug])).rows.length;
    if (gone) {
      res.set('X-Robots-Tag', 'noindex');
      return res.status(410).send(V.simple('This answer has been taken down', '', `/answers/${req.params.slug}`,
        `<p>The show that published this asked for it to come off the site, so it is no longer here.</p><p><a class="link" href="/answers">Browse the other answers</a> or <a class="link" href="/topics">pick a topic</a>.</p>`));
    }
    return res.status(404).send(V.notFound());
  }
  const a = r.rows[0];
  const [p, e, related, more] = await Promise.all([
    q(`SELECT * FROM podcasts WHERE slug=$1`, [a.podcast_slug]).then((x) => x.rows[0]),
    a.episode_id ? q(`SELECT * FROM episodes WHERE id=$1`, [a.episode_id]).then((x) => x.rows[0]) : null,
    q(`${ARTICLE_SELECT} AND p.category=$1 AND a.id<>$2 ORDER BY random() LIMIT 3`, [a.category, a.id]).then((x) => x.rows),
    q(`SELECT slug, question FROM articles WHERE podcast_id=(SELECT id FROM podcasts WHERE slug=$1) AND id<>$2 AND status='published' ORDER BY published_at DESC LIMIT 6`, [a.podcast_slug, a.id]).then((x) => x.rows),
  ]);
  logView(req, { podcastId: p.id, articleId: a.id });
  res.set('Cache-Control', 'public, max-age=300');
  res.send(V.articlePage({ a, p, e, related, moreFromShow: more }));
}));

/* ---------- podcasts ---------- */
app.get('/podcasts', wrap(async (req, res) => {
  const category = CATEGORIES[req.query.category] ? req.query.category : null;
  const [pods, counts] = await Promise.all([
    q(`SELECT * FROM podcasts ${category ? 'WHERE category=$1' : ''} ORDER BY (tier <> 'listed') DESC, featured DESC, title ASC`, category ? [category] : []),
    q(`SELECT category, count(*)::int AS n FROM podcasts GROUP BY category`),
  ]);
  res.send(V.podcastsIndex({ podcasts: pods.rows, category, counts: Object.fromEntries(counts.rows.map((r) => [r.category, r.n])) }));
}));

app.get('/podcasts/:slug', wrap(async (req, res) => {
  const p = (await q(`SELECT * FROM podcasts WHERE slug=$1`, [req.params.slug])).rows[0];
  if (!p) return res.status(404).send(V.notFound());
  const [eps, arts] = await Promise.all([
    q(`SELECT * FROM episodes WHERE podcast_id=$1 ORDER BY published_at DESC NULLS LAST LIMIT 30`, [p.id]),
    q(`${ARTICLE_SELECT} AND p.id=$1 ORDER BY a.published_at DESC`, [p.id]),
  ]);
  logView(req, { podcastId: p.id });
  res.set('Cache-Control', 'public, max-age=300');
  res.send(V.podcastPage({ p, episodes: eps.rows, articles: arts.rows, stats: { articles: arts.rows.length, episodes: eps.rows.length } }));
}));

app.get('/podcasts/:slug/episodes/:eslug', wrap(async (req, res) => {
  const p = (await q(`SELECT * FROM podcasts WHERE slug=$1`, [req.params.slug])).rows[0];
  if (!p) return res.status(404).send(V.notFound());
  const e = (await q(`SELECT * FROM episodes WHERE podcast_id=$1 AND slug=$2`, [p.id, req.params.eslug])).rows[0];
  if (!e) return res.status(404).send(V.notFound());
  // full transcripts only for members; listed shows get summary + excerpts inside articles
  if (p.tier === 'listed') e.transcript = null;
  const arts = await q(`${ARTICLE_SELECT} AND a.episode_id=$1`, [e.id]);
  logView(req, { podcastId: p.id });
  res.set('Cache-Control', 'public, max-age=600');
  res.send(V.episodePage({ p, e, articles: arts.rows }));
}));

/* ---------- outbound click tracking ---------- */
app.get('/go/:slug/:platform', wrap(async (req, res) => {
  const p = (await q(`SELECT * FROM podcasts WHERE slug=$1`, [req.params.slug])).rows[0];
  if (!p) return res.status(404).send(V.notFound());
  const map = { apple: p.apple_url, spotify: p.spotify_url, youtube: p.youtube_url, website: p.website, rss: p.feed_url };
  const target = map[req.params.platform];
  if (!target) return res.redirect(302, `/podcasts/${p.slug}`);
  const articleId = parseInt(req.query.a, 10) || null;
  if (!isBot(req.get('user-agent'))) {
    q(`INSERT INTO clicks (podcast_id, article_id, platform, referrer, user_agent) VALUES ($1,$2,$3,$4,$5)`,
      [p.id, articleId, req.params.platform, (req.get('referer') || '').slice(0, 300), (req.get('user-agent') || '').slice(0, 200)]).catch(() => {});
  }
  res.set('Cache-Control', 'no-store');
  res.redirect(302, target);
}));

/* ---------- generated article images ---------- */
app.get('/img/answer/:slug.png', wrap(async (req, res) => {
  const png = await articleImage(req.params.slug);
  if (!png) return res.status(404).end();
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.send(png);
}));

app.get('/img/blog/:slug.png', wrap(async (req, res) => {
  const png = await blogImage(req.params.slug);
  if (!png) return res.status(404).end();
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.send(png);
}));

/* ---------- accounts ---------- */
app.get('/signup', (req, res) => res.send(V.authPage({ mode: 'signup', next: req.query.next })));
app.post('/signup', wrap(async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.send(V.authPage({ mode: 'signup', error: 'Please enter a valid email address.', email }));
  if (String(b.password || '').length < 8) return res.send(V.authPage({ mode: 'signup', error: 'Password needs at least 8 characters.', email }));
  if (await auth.findUserByEmail(email)) return res.send(V.authPage({ mode: 'signup', error: 'That email already has an account. Sign in instead.', email }));
  if (!b.agree_terms) return res.send(V.authPage({ mode: 'signup', error: 'Please tick the box to agree to the Terms of Service and Refund Policy.', email }));
  const user = await auth.createUser({ email, password: b.password, name: b.name });
  await q(`UPDATE users SET terms_accepted_at=now(), terms_version=$2, terms_ip=$3 WHERE id=$1`, [user.id, TERMS_VERSION, String(req.ip || '')]);
  if (b.podcast_name) await billing.ensurePodcastForUser(user, { title: b.podcast_name, feedUrl: b.feed_url, category: 'business' });
  auth.setSession(res, user);
  res.redirect(b.next && b.next.startsWith('/') ? b.next : '/account');
}));
app.get('/login', (req, res) => res.send(V.authPage({ mode: 'login', next: req.query.next })));
app.post('/login', wrap(async (req, res) => {
  const b = req.body || {};
  const user = await auth.findUserByEmail(b.email);
  if (!user || !(await auth.check(String(b.password || ''), user.password_hash))) {
    return res.send(V.authPage({ mode: 'login', error: 'Email or password is not right.', email: b.email, next: b.next }));
  }
  auth.setSession(res, user);
  res.redirect(b.next && b.next.startsWith('/') ? b.next : '/account');
}));
app.get('/logout', (req, res) => { auth.clearSession(res); res.redirect('/'); });

async function accountData(user) {
  const podcast = (await q(`SELECT * FROM podcasts WHERE user_id=$1 ORDER BY id LIMIT 1`, [user.id])).rows[0] || null;
  const subscription = (await q(`SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY (status='active') DESC, id DESC LIMIT 1`, [user.id])).rows[0] || null;
  const articles = podcast ? (await q(`SELECT slug, question, published_at FROM articles WHERE podcast_id=$1 AND status='published' ORDER BY published_at DESC`, [podcast.id])).rows : [];
  const jobs = podcast ? (await q(`SELECT * FROM jobs WHERE podcast_id=$1 ORDER BY id DESC LIMIT 10`, [podcast.id])).rows : [];
  const totals = podcast ? (await q(
    `SELECT (SELECT count(*) FROM pageviews WHERE podcast_id=$1 AND created_at > now() - interval '30 days') AS views,
            (SELECT count(*) FROM clicks WHERE podcast_id=$1 AND created_at > now() - interval '30 days') AS clicks`, [podcast.id])).rows[0] : {};
  return { podcast, subscription, articles, jobs, totals };
}

app.get('/account', auth.requireUser, wrap(async (req, res) => {
  const data = await accountData(req.user);
  res.set('Cache-Control', 'no-store');
  res.send(V.accountPage({
    user: req.user, ...data, plans: billing.PLANS, stripeReady: billing.enabled(),
    notice: req.query.welcome ? 'Payment received. Your first batch of answers is being researched and written now, and lands within a day.' : (req.query.saved ? 'Saved.' : (req.query.canceled ? 'Checkout canceled, nothing was charged.' : null)),
  }));
}));

app.post('/account/podcast', auth.requireUser, wrap(async (req, res) => {
  const b = req.body || {};
  const pod = await billing.ensurePodcastForUser(req.user, { title: b.title, feedUrl: b.feed_url, category: CATEGORIES[b.category] ? b.category : 'business' });
  const yt = String(b.youtube_url || '').trim();
  if (yt && /^https:\/\/(www\.|m\.)?youtube\.com\//.test(yt)) {
    await q(`UPDATE podcasts SET youtube_url=$2, updated_at=now() WHERE id=$1`, [pod && pod.id ? pod.id : 0, yt.slice(0, 300)]).catch(() => {});
    if (!pod || !pod.id) await q(`UPDATE podcasts SET youtube_url=$2, updated_at=now() WHERE user_id=$1`, [req.user.id, yt.slice(0, 300)]).catch(() => {});
  }
  res.redirect('/account?saved=1');
}));

app.post('/account/checkout', auth.requireUser, wrap(async (req, res) => {
  if (!billing.enabled()) return res.redirect('/account');
  const { podcast } = await accountData(req.user);
  if (!podcast || !podcast.feed_url) return res.redirect('/account');
  if (!podcast.category_confirmed_at) return res.redirect('/account?error=eligibility');
  await q(`UPDATE users SET terms_accepted_at=COALESCE(terms_accepted_at, now()), terms_version=$2, terms_ip=$3, checkout_terms_at=now() WHERE id=$1`, [req.user.id, TERMS_VERSION, String(req.ip || '')]);
  const session = await billing.createCheckout({ user: req.user, plan: req.body.plan, podcast, siteUrl: V.SITE.url });
  res.redirect(303, session.url);
}));

app.post('/account/portal', auth.requireUser, wrap(async (req, res) => {
  if (!billing.enabled()) return res.redirect('/account');
  const session = await billing.billingPortal({ user: req.user, siteUrl: V.SITE.url });
  res.redirect(303, session.url);
}));

/* ---------- job API (Make calls these) ---------- */
const jobAuth = (req, res, next) => {
  const secret = process.env.JOB_SECRET || '';
  const given = req.get('x-job-secret') || req.query.secret || (req.body && req.body.secret) || '';
  const contentKey = process.env.CONTENT_API_KEY || '';
  const ok = (secret && given === secret) || (contentKey && given === contentKey);
  return ok ? next() : res.status(401).json({ error: 'unauthorized' });
};

// The old AI job pipeline is retired: articles are written by the daily COO task and members
// choose episodes on their dashboard. These routes stay so old Make scenarios get a clean 200.
const RETIRED = { ok: true, retired: true, note: 'writing moved to the daily COO task via /api/content/*' };
app.get('/api/jobs/due', jobAuth, (req, res) => res.json({ jobs: [], ...RETIRED }));
app.post('/api/jobs/:id/run', jobAuth, (req, res) => res.json(RETIRED));
app.post('/api/jobs/create', jobAuth, (req, res) => res.json(RETIRED));
app.post('/api/jobs/monthly', jobAuth, (req, res) => res.json({ queued: [], ...RETIRED }));

// One click stops the weekly email without touching the subscription.
app.get('/reports/off/:token', wrap(async (req, res) => {
  const p = (await q(`SELECT * FROM podcasts WHERE dashboard_token=$1`, [req.params.token])).rows[0];
  if (!p) return res.status(404).send(V.notFound());
  if (p.user_id) await q(`UPDATE users SET report_opt_out=true WHERE id=$1`, [p.user_id]);
  res.send(V.simple('Weekly emails stopped', '', '/reports/off', `<p>We will stop sending the weekly numbers for ${esc(p.title)}. Your plan and your articles are unaffected.</p><p><a class="link" href="/dashboard/${esc(p.dashboard_token)}">Your dashboard is still here</a>, and it updates daily. Email <a href="mailto:${esc(process.env.CONTACT_EMAIL || 'sean@mainstreetmakes.com')}">us</a> to turn the emails back on.</p>`));
}));

/* ---------- reporting API (Make calls these) ---------- */
// Make holds the Google Search Console connection and posts the week's rows here.
app.post('/api/reports/gsc', jobAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const week = b.start && b.end ? { start: b.start, end: b.end } : reports.lastWeek();
  const r = await reports.ingestGsc({ start: week.start, end: week.end, rows: b.rows || [] });
  console.log('gsc ingest', JSON.stringify(r));
  res.json({ ok: true, ...r });
}));

// Send every active member their week. dry=1 returns what would go out instead.
app.post('/api/reports/weekly', jobAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const r = await reports.sendWeekly({
    start: b.start, end: b.end,
    dryRun: !!b.dry, onlySlug: b.slug || null,
  });
  const brief = r.results.map((x) => ({ podcast: x.podcast, to: x.to, sent: x.sent, skipped: x.skipped, error: x.error, subject: x.subject }));
  console.log('weekly reports', JSON.stringify({ period: r.period, brief }));
  res.json({ ok: true, period: r.period, count: r.count, results: b.dry ? r.results.map(({ html, ...rest }) => rest) : brief });
}));

// A rendered preview of one member's email, for checking the thing before it ships.
app.get('/api/reports/preview', jobAuth, wrap(async (req, res) => {
  const slug = req.query.slug || '';
  const p = (await q(`SELECT * FROM podcasts WHERE slug=$1`, [slug])).rows[0];
  if (!p) return res.status(404).json({ error: 'podcast not found' });
  const week = req.query.start && req.query.end ? { start: req.query.start, end: req.query.end } : reports.lastWeek();
  if (req.query.kind === 'welcome') {
    const u = p.user_id ? (await q(`SELECT * FROM users WHERE id=$1`, [p.user_id])).rows[0] : null;
    const { html } = mail.welcomeEmail({ name: u ? u.name : '', podcast: p.title, plan: 'Growth', quota: 4, dashboardUrl: `${process.env.SITE_URL || 'https://podanswer.com'}/dashboard/${p.dashboard_token}` });
    return res.type('html').send(html);
  }
  const data = await reports.weekFor(p, week.start, week.end);
  res.type('html').send(mail.weeklyEmail(data).html);
}));

// Health line for the mail and reporting side.
app.get('/api/reports/status', jobAuth, wrap(async (req, res) => {
  const [members, latest, sent] = await Promise.all([
    q(`SELECT count(*)::int AS n FROM subscriptions WHERE status='active' AND podcast_id IS NOT NULL`),
    q(`SELECT period_start, period_end, count(*)::int AS rows, count(podcast_id)::int AS matched FROM gsc_rows GROUP BY 1,2 ORDER BY 1 DESC LIMIT 3`),
    q(`SELECT kind, status, count(*)::int AS n, max(created_at) AS last FROM emails GROUP BY 1,2 ORDER BY 1,2`),
  ]);
  res.json({
    resend: mail.enabled() ? 'configured' : 'RESEND_API_KEY not set',
    active_members: members.rows[0].n,
    gsc_periods: latest.rows,
    emails: sent.rows,
  });
}));

/* ---------- content API (used by the daily COO task through the Make tool "PodAnswer API Call") ---------- */
// Everything here is behind jobAuth. It lets an outside writer read the material it needs
// (shows, episodes, transcripts, what is already answered) and publish finished pieces,
// without any database access or any use of the site's own AI key.
app.get('/api/content/overview', jobAuth, wrap(async (req, res) => {
  const pods = await q(`SELECT p.id, p.slug, p.title, p.author, p.category, p.user_id,
      (SELECT count(*) FROM episodes e WHERE e.podcast_id=p.id AND e.transcript IS NOT NULL) AS transcribed_episodes,
      (SELECT count(*) FROM articles a WHERE a.podcast_id=p.id AND a.status='published') AS articles_total,
      (SELECT count(*) FROM articles a WHERE a.podcast_id=p.id AND a.status='published' AND a.published_at >= date_trunc('month', now())) AS articles_this_month,
      s.plan, s.quota, s.status AS sub_status, s.current_period_end
    FROM podcasts p LEFT JOIN LATERAL (SELECT plan, quota, status, current_period_end FROM subscriptions WHERE podcast_id=p.id ORDER BY (status='active') DESC, updated_at DESC LIMIT 1) s ON true
    ORDER BY (s.status='active') DESC NULLS LAST, p.title`);
  const blog = await q(`SELECT slug, title, published_at FROM blog_posts ORDER BY published_at DESC LIMIT 200`);
  const queued = (await q(`SELECT count(*)::int AS n FROM article_orders WHERE status='queued'`)).rows[0].n;
  const openSugg = (await q(`SELECT podcast_id, count(*)::int AS n FROM suggestions WHERE status='open' GROUP BY podcast_id`)).rows;
  res.json({ podcasts: pods.rows, blog_posts: blog.rows, queued_orders: queued, open_suggestions_by_podcast: openSugg, site: V.SITE.url });
}));
app.get('/api/content/podcast/:idOrSlug', jobAuth, wrap(async (req, res) => {
  const p = (await q(`SELECT * FROM podcasts WHERE id=$1 OR slug=$2`, [parseInt(req.params.idOrSlug, 10) || 0, req.params.idOrSlug])).rows[0];
  if (!p) return res.status(404).json({ error: 'podcast not found' });
  const eps = await q(`SELECT id, slug, title, published_at, (transcript IS NOT NULL) AS has_transcript, length(transcript) AS transcript_chars, left(summary, 400) AS summary FROM episodes WHERE podcast_id=$1 ORDER BY published_at DESC LIMIT 100`, [p.id]);
  const arts = await q(`SELECT id, slug, question, published_at FROM articles WHERE podcast_id=$1 AND status='published' ORDER BY published_at DESC`, [p.id]);
  res.json({ podcast: p, episodes: eps.rows, articles: arts.rows });
}));
app.get('/api/content/episode/:id', jobAuth, wrap(async (req, res) => {
  const e = (await q(`SELECT e.*, p.slug AS podcast_slug, p.title AS podcast_title FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=$1`, [parseInt(req.params.id, 10) || 0])).rows[0];
  if (!e) return res.status(404).json({ error: 'episode not found' });
  const max = Math.min(parseInt(req.query.max, 10) || 60000, 120000);
  if (e.transcript) e.transcript = e.transcript.slice(0, max);
  res.json(e);
}));
// Work for the daily writer: every queued order (new articles and paid rewrites), oldest first.
app.get('/api/content/orders', jobAuth, wrap(async (req, res) => {
  const r = await q(`SELECT o.id AS order_id, o.kind, o.status, o.target_query, o.note, o.created_at, o.billing_period,
      p.slug AS podcast, p.title AS podcast_title, s.plan, s.quota,
      e.id AS episode_id, e.title AS episode_title, (e.transcript IS NOT NULL) AS has_transcript, length(coalesce(e.summary,'')) AS summary_chars,
      a.slug AS article_slug, a.question AS article_question, u.email AS member_email
    FROM article_orders o JOIN podcasts p ON p.id=o.podcast_id
    LEFT JOIN subscriptions s ON s.id=o.subscription_id LEFT JOIN episodes e ON e.id=o.episode_id
    LEFT JOIN articles a ON a.id=o.article_id LEFT JOIN users u ON u.id=o.user_id
    WHERE o.status='queued' ORDER BY o.created_at LIMIT 50`);
  res.json({ orders: r.rows });
}));
app.post('/api/content/order-fail', jobAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const r = await q(`UPDATE article_orders SET status='failed', detail=$2, finished_at=now() WHERE id=$1 AND status='queued' RETURNING id`, [parseInt(b.order_id, 10) || 0, String(b.reason || 'could not be written').slice(0, 500)]);
  if (r.rowCount) ordersDone([r.rows[0].id]).catch(() => {});
  res.json({ ok: !!r.rowCount });
}));
// Article ideas for members to choose from, with an estimated monthly search figure. Body:
// { items:[{podcast, episode_id, question, focus_keyword, est_monthly_searches, source}], replace:true }
app.post('/api/content/suggestions', jobAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  let n = 0; const cleared = new Set();
  for (const it of items) {
    const p = (await q(`SELECT id FROM podcasts WHERE id=$1 OR slug=$2`, [parseInt(it.podcast, 10) || 0, String(it.podcast || '')])).rows[0];
    const eid = parseInt(it.episode_id, 10) || 0;
    if (!p || !eid || !it.question) continue;
    const e = await q(`SELECT 1 FROM episodes WHERE id=$1 AND podcast_id=$2`, [eid, p.id]);
    if (!e.rowCount) continue;
    if (b.replace && !cleared.has(eid)) { await q(`DELETE FROM suggestions WHERE episode_id=$1 AND status='open'`, [eid]); cleared.add(eid); }
    await q(`INSERT INTO suggestions (podcast_id, episode_id, question, focus_keyword, est_monthly_searches, source) VALUES ($1,$2,$3,$4,$5,$6)`,
      [p.id, eid, String(it.question).slice(0, 300), it.focus_keyword ? String(it.focus_keyword).slice(0, 200) : null,
       Number.isFinite(+it.est_monthly_searches) ? Math.round(+it.est_monthly_searches) : null, it.source ? String(it.source).slice(0, 200) : null]);
    n++;
  }
  res.json({ ok: true, inserted: n });
}));
// Transcribe one episode on demand (used for ordered episodes that have no transcript yet).
// Paying members only. Runs in the background and returns at once; poll /api/content/episode/ID.
app.post('/api/content/transcribe/:id', jobAuth, wrap(async (req, res) => {
  const e = (await q(`SELECT e.*, p.tier, p.youtube_url FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=$1`, [parseInt(req.params.id, 10) || 0])).rows[0];
  if (!e) return res.status(404).json({ error: 'episode not found' });
  if (e.transcript) return res.json({ ok: true, already: true, chars: e.transcript.length });
  if (e.tier === 'listed') return res.status(403).json({ error: 'free listings are not transcribed' });
  require('./ingest').transcribeEpisode(e).then((r) => console.log('transcribe', e.id, JSON.stringify(r))).catch((x) => console.warn('transcribe failed', e.id, x.message));
  res.json({ ok: true, started: true, note: 'check /api/content/episode/' + e.id + ' in a few minutes' });
}));
// Publish a podcast answer article. Body: { podcast (id or slug), episode_id, question, slug?, meta_description, body: {intro, sections[], keyTakeaways[], faq[], sourceNote} }
app.post('/api/content/article', jobAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const p = (await q(`SELECT * FROM podcasts WHERE id=$1 OR slug=$2`, [parseInt(b.podcast, 10) || 0, String(b.podcast || '')])).rows[0];
  if (!p) return res.status(404).json({ error: 'podcast not found' });
  const body = b.body || {};
  if (!b.question || !body.intro || !Array.isArray(body.sections) || !body.sections.length) return res.status(400).json({ error: 'question, body.intro and body.sections are required' });
  const episodeId = parseInt(b.episode_id, 10) || null;
  if (episodeId) {
    const ok = await q(`SELECT 1 FROM episodes WHERE id=$1 AND podcast_id=$2`, [episodeId, p.id]);
    if (!ok.rowCount) return res.status(400).json({ error: 'episode does not belong to that podcast' });
  }
  const slug = slugify(b.slug || b.question);
  const r = await q(
    `INSERT INTO articles (podcast_id, episode_id, slug, question, meta_description, body, status)
     VALUES ($1,$2,$3,$4,$5,$6,'published') ON CONFLICT (slug) DO NOTHING RETURNING id, slug`,
    [p.id, episodeId, slug, String(b.question).slice(0, 300), String(b.meta_description || '').slice(0, 300),
     JSON.stringify({ intro: body.intro, sections: body.sections, keyTakeaways: body.keyTakeaways || [], faq: body.faq || [], sourceNote: body.sourceNote || '' })]
  );
  if (!r.rows[0]) return res.status(409).json({ error: 'slug already exists', slug });
  const orderId = parseInt(b.order_id, 10) || 0;
  if (orderId) {
    const o = await q(`UPDATE article_orders SET status='done', article_id=$2, target_query=COALESCE(target_query,$3), detail=$4, started_at=COALESCE(started_at, now()), finished_at=now() WHERE id=$1 AND podcast_id=$5 RETURNING id`,
      [orderId, r.rows[0].id, String(b.target_query || b.question).slice(0, 300), b.detail ? String(b.detail).slice(0, 500) : null, p.id]);
    if (o.rowCount) ordersDone([orderId]).catch(() => {});
  }
  res.json({ ok: true, id: r.rows[0].id, slug, url: `${V.SITE.url}/answers/${slug}` });
}));
// Publish a blog post (podcast promotion and marketing keywords). Body: { title, slug?, meta_description, body_md }
app.post('/api/content/blog', jobAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.body_md) return res.status(400).json({ error: 'title and body_md are required' });
  const slug = slugify(b.slug || b.title);
  const r = await q(`INSERT INTO blog_posts (slug, title, meta_description, body_md) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING RETURNING id`,
    [slug, String(b.title).slice(0, 300), String(b.meta_description || '').slice(0, 300), String(b.body_md)]);
  if (!r.rows[0]) return res.status(409).json({ error: 'slug already exists', slug });
  res.json({ ok: true, id: r.rows[0].id, slug, url: `${V.SITE.url}/blog/${slug}` });
}));
// Update an existing blog post or article body (for corrections). Body: { slug, body_md? | body?, meta_description?, title?/question? }
app.post('/api/content/update', jobAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.slug) return res.status(400).json({ error: 'slug required' });
  if (b.body_md !== undefined) {
    const r = await q(`UPDATE blog_posts SET body_md=$2, title=COALESCE($3,title), meta_description=COALESCE($4,meta_description), updated_at=now() WHERE slug=$1 RETURNING slug`, [b.slug, String(b.body_md), b.title || null, b.meta_description || null]);
    return r.rowCount ? res.json({ ok: true, url: `${V.SITE.url}/blog/${b.slug}` }) : res.status(404).json({ error: 'not found' });
  }
  if (b.body) {
    const r = await q(`UPDATE articles SET body=$2, question=COALESCE($3,question), meta_description=COALESCE($4,meta_description), rewrites=rewrites+1, updated_at=now() WHERE slug=$1 RETURNING id`, [b.slug, JSON.stringify(b.body), b.question || null, b.meta_description || null]);
    if (!r.rowCount) return res.status(404).json({ error: 'not found' });
    await q(`DELETE FROM article_images WHERE article_id=$1`, [r.rows[0].id]).catch(() => {});
    const orderId = parseInt(b.order_id, 10) || 0;
    if (orderId) {
      const o = await q(`UPDATE article_orders SET status='done', started_at=COALESCE(started_at, now()), finished_at=now() WHERE id=$1 AND kind='rewrite' AND article_id=$2 RETURNING id`, [orderId, r.rows[0].id]);
      if (o.rowCount) ordersDone([orderId]).catch(() => {});
    }
    return res.json({ ok: true, url: `${V.SITE.url}/answers/${b.slug}` });
  }
  res.status(400).json({ error: 'nothing to update' });
}));

// Full transcript for readers who want the whole conversation. Deliberately not indexed:
// the article is the page Google should rank, this is the source for people who click through.
app.get('/transcripts/:id', wrap(async (req, res) => {
  const e = (await q(`SELECT e.*, p.slug AS pslug, p.title AS ptitle, p.tier, p.author FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=$1`, [parseInt(req.params.id, 10) || 0])).rows[0];
  if (!e || !e.transcript || e.tier === 'listed') return res.status(404).send(V.notFound());
  const back = req.query.from ? `/answers/${encodeURIComponent(String(req.query.from))}` : `/podcasts/${e.pslug}/episodes/${e.slug}`;
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.send(V.transcriptPage({ e, back }));
}));

/* ---------- static pages ---------- */
app.get('/for-podcasters', (req, res) => res.send(V.forPodcasters()));
app.get('/how-it-works', (req, res) => res.redirect(301, '/for-podcasters'));
app.get('/pricing', (req, res) => res.send(V.pricing()));
app.get('/for-studios', (req, res) => res.send(V.forStudios()));
app.get('/about', (req, res) => res.send(V.about()));
app.get('/privacy', (req, res) => res.send(V.simple('Privacy policy', 'PodAnswer privacy policy.', '/privacy', `
<p>PodAnswer (operated by Mini Machine Creative LLC, doing business as Main Street Creative) collects the information you submit through our forms (name, email, podcast details) so we can respond and provide the service. We record anonymous page views and outbound link clicks to report performance to podcasters. We use Google Analytics and Google Search Console. We do not sell personal information.</p>
<p>Podcast artwork, descriptions and audio shown on this site belong to their creators and are used to describe and link to their shows. To update or remove a listing, email <a href="mailto:${esc(V.SITE.email)}">${esc(V.SITE.email)}</a>.</p>
<p>Questions: Main Street Creative, 152 N Main St, Doylestown, PA 18901.</p>`)));
const TERMS_VERSION = '2026-09-23';
app.get('/terms', (req, res) => res.send(V.simple('Terms of service', 'PodAnswer terms of service: what a plan buys, billing, refunds, content rights and how to reach us before disputing a charge.', '/terms', `
<p class="muted small">Version ${TERMS_VERSION}</p>
<h2>What you are buying</h2>
<p>A PodAnswer plan buys a fixed number of published articles per billing month. Growth is four articles a month. Network is twelve. Each article answers a real search question using quoted, timestamped excerpts from your podcast and links back to your show. Plans also include a weekly report covering search impressions, clicks, average position, the searches your pages appeared for, and taps on your listen links. Article rewrites are fifteen dollars each and keep the original web address.</p>
<h2>What we do not promise</h2>
<p>We do not guarantee any search ranking, any amount of traffic, any number of listeners, downloads or subscribers, or any revenue. Search engines decide what ranks and they change their minds. Anyone who promises you a ranking is guessing. What we guarantee is the work: the articles get researched, written, published and reported on.</p>
<h2>Billing</h2>
<p>Plans bill monthly in advance and renew automatically until cancelled. You may cancel at any time and your plan runs to the end of the period you have already paid for. We do not prorate partial months. Articles already published stay on the site after cancellation unless you ask us to remove them.</p>
<h2>Refunds</h2>
<p>If articles you paid for were not published in the billing month they were owed, tell us and we will either publish them or refund the unpublished portion of that month. We do not refund months in which the work was delivered, because dissatisfaction with search results is not a failure to deliver. Refund requests must reach us within sixty days of the charge. The full <a href="/refunds">refund policy</a> is its own page.</p>
<h2>Your content</h2>
<p>You keep every right you already have in your podcast. By joining you give us permission to transcribe your episodes, quote excerpts from them, use your show name and artwork to identify your show, and publish articles built from that material. You confirm you have the right to give that permission. You can have any article taken down for free at any time, instantly, from your dashboard.</p>
<h2>Our content</h2>
<p>The articles we write, the site and its design belong to us. You may link to your articles and share them anywhere.</p>
<h2>Limitation of liability</h2>
<p>The service is provided as is. To the fullest extent the law allows, we are not liable for indirect, incidental, special or consequential damages, or for lost profits, lost traffic or lost business. Our total liability for any claim is limited to the amount you paid us in the three months before the claim arose.</p>
<h2>Before you dispute a charge</h2>
<p>Contact <a href="mailto:${esc(V.SITE.email)}">${esc(V.SITE.email)}</a> first. We answer within one business day and we keep a dated record of every article published and every report sent for your account. Most billing questions are settled the same day. A chargeback filed without contacting us first costs both of us money and time that a single email would have saved.</p>
<h2>Governing law</h2>
<p>Pennsylvania.</p>
<h2>Changes</h2>
<p>We may update these terms. Material changes will be emailed to active members at least fourteen days before they take effect.</p>
<p>Contact: <a href="mailto:${esc(V.SITE.email)}">${esc(V.SITE.email)}</a>. PodAnswer is operated by Mini Machine Creative LLC, doing business as Main Street Creative, 152 N Main St, Doylestown, PA 18901.</p>`)));
app.get('/disclaimer', (req, res) => res.send(V.simple('Disclaimer', 'PodAnswer articles are general information drawn from podcast conversations, not professional advice. How we quote, attribute and correct.', '/disclaimer', `
<p>Everything on PodAnswer is general information drawn from podcast conversations. It is not professional advice. Nothing here is medical, legal, financial, tax or investment advice, and reading it does not create any professional relationship. The people quoted are speaking in their own capacity on their own shows, not on behalf of PodAnswer.</p>
<p>We quote podcast episodes under fair use for the purpose of reporting and commentary, we attribute every quote to the show and the episode, we link to the source, and we point to the exact minute so you can hear it yourself. Podcast artwork and audio belong to their creators. If you own a show and want something changed or removed, email <a href="mailto:${esc(V.SITE.email)}">${esc(V.SITE.email)}</a> and we will act on it.</p>
<p>Transcripts are produced automatically and can contain errors. Where a quote matters, listen to the linked moment.</p>`)));
app.get('/refunds', (req, res) => res.send(V.simple('Refund policy', 'PodAnswer refund policy: monthly billing in advance, cancel any time, refunds for articles that were owed and not published.', '/refunds', `
<p>Plans bill monthly in advance. Cancel any time and your plan runs to the end of the period you have paid for.</p>
<p>We refund the unpublished portion of a month when articles you paid for were not published in the month they were owed. Tell us within sixty days of the charge and we will publish them or refund that portion.</p>
<p>We do not refund a month in which the articles were published and the report was sent. Search results are outside anyone's control, and that is stated plainly before you buy.</p>
<p>Rewrites are fifteen dollars and are refundable only if the rewrite was never delivered.</p>
<p>Contact <a href="mailto:${esc(V.SITE.email)}">${esc(V.SITE.email)}</a> before disputing a charge with your bank. We hold a dated record of every article and every report for your account and we will send it to you on request.</p>`)));

/* ---------- join / leads ---------- */
app.get('/join', (req, res) => res.send(V.joinPage({ plan: req.query.plan, podcast: req.query.podcast, sent: req.query.sent === '1', error: null })));
app.post('/join', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website_url) return res.redirect('/join?sent=1'); // honeypot
  if (!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return res.send(V.joinPage({ plan: b.plan, podcast: b.podcast_name, sent: false, error: 'Please enter a valid email address.' }));
  await q(`INSERT INTO leads (name, email, podcast_name, feed_url, plan, message, source) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [String(b.name || '').slice(0, 120), String(b.email).slice(0, 200), String(b.podcast_name || '').slice(0, 200), String(b.feed_url || '').slice(0, 500), String(b.plan || 'listed').slice(0, 20), String(b.message || '').slice(0, 2000), (req.get('referer') || '').slice(0, 300)]);
  if (process.env.LEAD_WEBHOOK_URL) {
    fetch(process.env.LEAD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: b.name, email: b.email, podcast_name: b.podcast_name, feed_url: b.feed_url, plan: b.plan, message: b.message, site: 'podanswer.com' }) }).catch(() => {});
  }
  res.redirect('/join?sent=1');
}));

/* ---------- blog ---------- */
app.get('/blog', wrap(async (req, res) => {
  const r = await q(`SELECT slug, title, meta_description, published_at FROM blog_posts ORDER BY published_at DESC`);
  res.send(V.blogIndex({ posts: r.rows }));
}));
// Retired posts point at the article that replaced them, so any existing link keeps its value.
const BLOG_REDIRECTS = {
  'podcast-promotion-services-what-to-expect': 'podcast-promotion-services',
  'podcast-agency-vs-diy-promotion': 'podcast-marketing-agency',
};
app.get('/blog/:slug', wrap(async (req, res) => {
  if (BLOG_REDIRECTS[req.params.slug]) return res.redirect(301, `/blog/${BLOG_REDIRECTS[req.params.slug]}`);
  const b = (await q(`SELECT * FROM blog_posts WHERE slug=$1`, [req.params.slug])).rows[0];
  if (!b) return res.status(404).send(V.notFound());
  const recent = (await q(`SELECT slug, title FROM blog_posts WHERE slug<>$1 ORDER BY published_at DESC LIMIT 5`, [b.slug])).rows;
  logView(req, {});
  res.send(V.blogPost({ b, recent }));
}));

/* ---------- podcaster dashboard ---------- */
app.get('/dashboard/:token', wrap(async (req, res) => {
  const p = (await q(`SELECT * FROM podcasts WHERE dashboard_token=$1`, [req.params.token])).rows[0];
  if (!p) return res.status(404).send(V.notFound());
  const [arts, plat, daily, totals] = await Promise.all([
    q(`SELECT a.id, a.slug, a.question, a.published_at, a.removed_at, a.rewrites,
         (SELECT count(*) FROM pageviews v WHERE v.article_id=a.id AND v.created_at > now() - interval '30 days')::int AS views,
         (SELECT count(*) FROM clicks c WHERE c.article_id=a.id AND c.created_at > now() - interval '30 days')::int AS clicks
       FROM articles a WHERE a.podcast_id=$1 AND a.status IN ('published','removed') ORDER BY a.removed_at NULLS FIRST, views DESC, a.published_at DESC`, [p.id]),
    q(`SELECT platform, count(*)::int AS n FROM clicks WHERE podcast_id=$1 AND created_at > now() - interval '30 days' GROUP BY platform ORDER BY n DESC`, [p.id]),
    q(`SELECT d::date AS day,
         (SELECT count(*) FROM pageviews v WHERE v.podcast_id=$1 AND v.created_at::date = d::date)::int AS views,
         (SELECT count(*) FROM clicks c WHERE c.podcast_id=$1 AND c.created_at::date = d::date)::int AS clicks
       FROM generate_series(now() - interval '29 days', now(), interval '1 day') d ORDER BY d`, [p.id]),
    q(`SELECT (SELECT count(*) FROM pageviews WHERE podcast_id=$1 AND created_at > now() - interval '30 days') AS views,
              (SELECT count(*) FROM clicks WHERE podcast_id=$1 AND created_at > now() - interval '30 days') AS clicks`, [p.id]),
  ]);
  const [eps, ords, sub] = await Promise.all([
    q(`SELECT e.id, e.title, e.published_at,
         (e.transcript IS NOT NULL OR length(coalesce(e.summary,'')) > 250) AS has_text,
         (SELECT count(*) FROM articles a WHERE a.episode_id=e.id AND a.status='published')::int AS article_count
       FROM episodes e WHERE e.podcast_id=$1 ORDER BY e.published_at DESC NULLS LAST LIMIT 150`, [p.id]),
    q(`SELECT o.*, e.title AS episode_title, a.slug AS article_slug
       FROM article_orders o LEFT JOIN episodes e ON e.id=o.episode_id LEFT JOIN articles a ON a.id=o.article_id
       WHERE o.podcast_id=$1 ORDER BY o.created_at DESC LIMIT 25`, [p.id]),
    q(`SELECT * FROM subscriptions WHERE podcast_id=$1 AND status='active' ORDER BY updated_at DESC LIMIT 1`, [p.id]),
  ]);
  const sugg = await q(`SELECT id, episode_id, question, focus_keyword, est_monthly_searches FROM suggestions WHERE podcast_id=$1 AND status='open' ORDER BY est_monthly_searches DESC NULLS LAST, id`, [p.id]);
  const s0 = sub.rows[0];
  const period = periodStart(s0);
  const used = s0 ? (await q(
    `SELECT count(*)::int AS n FROM article_orders
     WHERE podcast_id=$1 AND kind='new' AND status <> 'failed' AND created_at >= $2`, [p.id, period])).rows[0].n : 0;
  res.set('Cache-Control', 'no-store');
  res.send(V.dashboard({
    p, articles: arts.rows, clicksByPlatform: plat.rows, daily: daily.rows, totals: totals.rows[0],
    episodes: eps.rows, orders: ords.rows, suggestions: sugg.rows,
    quota: s0 ? s0.quota : 0, used, periodEnd: s0 ? s0.current_period_end : null,
    rewritePrice: REWRITE_PRICE / 100,
  }));
}));

/* ---------- self-serve article requests ---------- */
const REWRITE_PRICE = parseInt(process.env.REWRITE_PRICE_CENTS || '1500', 10);

// The month the member is in, so the quota resets with their billing.
function periodStart(sub) {
  if (!sub) return new Date(0);
  if (sub.current_period_end) {
    const d = new Date(sub.current_period_end);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d;
  }
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 30); return d;
}

async function memberFromToken(token) {
  const p = (await q(`SELECT * FROM podcasts WHERE dashboard_token=$1`, [token])).rows[0];
  if (!p) return null;
  const sub = (await q(`SELECT * FROM subscriptions WHERE podcast_id=$1 AND status='active' ORDER BY updated_at DESC LIMIT 1`, [p.id])).rows[0];
  return { p, sub };
}

app.post('/dashboard/:token/request', wrap(async (req, res) => {
  const m = await memberFromToken(req.params.token);
  if (!m) return res.status(404).send(V.notFound());
  const { p, sub } = m;
  if (!sub) return res.redirect(`/dashboard/${p.dashboard_token}?error=noplan`);

  let ids = req.body.episode_id || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = [...new Set(ids.map((x) => parseInt(x, 10)).filter(Boolean))];
  if (!ids.length) return res.redirect(`/dashboard/${p.dashboard_token}`);

  const period = periodStart(sub);
  const used = (await q(
    `SELECT count(*)::int AS n FROM article_orders WHERE podcast_id=$1 AND kind='new' AND status <> 'failed' AND created_at >= $2`,
    [p.id, period])).rows[0].n;
  const left = Math.max(0, sub.quota - used);
  ids = ids.slice(0, left);
  if (!ids.length) return res.redirect(`/dashboard/${p.dashboard_token}?error=quota`);

  const made = [];
  for (const episodeId of ids) {
    const e = (await q(`SELECT id FROM episodes WHERE id=$1 AND podcast_id=$2`, [episodeId, p.id])).rows[0];
    if (!e) continue;
    const open = await q(`SELECT 1 FROM article_orders WHERE episode_id=$1 AND kind='new' AND status IN ('queued','researching','writing')`, [e.id]);
    if (open.rowCount) continue;
    const choice = String((req.body[`suggestion_${episodeId}`] || 'auto'));
    let sg = null;
    if (choice !== 'auto') sg = (await q(`SELECT * FROM suggestions WHERE id=$1 AND episode_id=$2 AND podcast_id=$3`, [parseInt(choice, 10) || 0, e.id, p.id])).rows[0] || null;
    const o = (await q(
      `INSERT INTO article_orders (podcast_id, episode_id, subscription_id, user_id, kind, status, billing_period, target_query, suggestion_id)
       VALUES ($1,$2,$3,$4,'new','queued',$5,$6,$7) RETURNING id`,
      [p.id, e.id, sub.id, sub.user_id, period, sg ? sg.question : null, sg ? sg.id : null])).rows[0];
    if (sg) await q(`UPDATE suggestions SET status='ordered' WHERE id=$1`, [sg.id]);
    made.push(o.id);
  }
  ordersNotify(p, made).catch(() => {});
  res.redirect(`/dashboard/${p.dashboard_token}?queued=${made.length}`);
}));

app.post('/dashboard/:token/takedown', wrap(async (req, res) => {
  const m = await memberFromToken(req.params.token);
  if (!m) return res.status(404).send(V.notFound());
  await q(`UPDATE articles SET status='removed', removed_at=now(), updated_at=now() WHERE id=$1 AND podcast_id=$2`,
    [parseInt(req.body.article_id, 10), m.p.id]);
  res.redirect(`/dashboard/${m.p.dashboard_token}`);
}));

app.post('/dashboard/:token/restore', wrap(async (req, res) => {
  const m = await memberFromToken(req.params.token);
  if (!m) return res.status(404).send(V.notFound());
  await q(`UPDATE articles SET status='published', removed_at=NULL, updated_at=now() WHERE id=$1 AND podcast_id=$2`,
    [parseInt(req.body.article_id, 10), m.p.id]);
  res.redirect(`/dashboard/${m.p.dashboard_token}`);
}));

// A rewrite is a one-off charge, so it goes through Checkout and starts on payment.
app.post('/dashboard/:token/rewrite', wrap(async (req, res) => {
  const m = await memberFromToken(req.params.token);
  if (!m) return res.status(404).send(V.notFound());
  const { p, sub } = m;
  const a = (await q(`SELECT * FROM articles WHERE id=$1 AND podcast_id=$2`, [parseInt(req.body.article_id, 10), p.id])).rows[0];
  if (!a) return res.redirect(`/dashboard/${p.dashboard_token}`);
  if (!billing.enabled()) return res.redirect(`/dashboard/${p.dashboard_token}?error=billing`);
  // an unpaid rewrite left from an abandoned checkout is replaced, not stacked
  await q(`DELETE FROM article_orders WHERE article_id=$1 AND kind='rewrite' AND status='awaiting_payment'`, [a.id]);

  const o = (await q(
    `INSERT INTO article_orders (podcast_id, episode_id, article_id, subscription_id, user_id, kind, status, amount_cents, note)
     VALUES ($1,$2,$3,$4,$5,'rewrite','awaiting_payment',$6,$7) RETURNING id`,
    [p.id, a.episode_id, a.id, sub ? sub.id : null, sub ? sub.user_id : p.user_id, REWRITE_PRICE, (req.body.note || '').slice(0, 500)])).rows[0];

  const session = await billing.createRewriteCheckout({
    podcast: p, article: a, orderId: o.id, amount: REWRITE_PRICE,
    siteUrl: `${req.protocol}://${req.get('host')}`,
  });
  await q(`UPDATE article_orders SET stripe_session_id=$2 WHERE id=$1`, [o.id, session.id]);
  res.redirect(303, session.url);
}));

// Make gets told there is work. The daily writer fulfils it through /api/content/orders.
async function ordersNotify(p, ids) {
  if (!process.env.MAKE_ORDER_WEBHOOK || !ids.length) return;
  await fetch(process.env.MAKE_ORDER_WEBHOOK, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'orders.queued', podcast: p.title, podcast_slug: p.slug, order_ids: ids,
      run_url: `${process.env.SITE_URL || 'https://podanswer.com'}/api/orders/run`, secret: process.env.JOB_SECRET || '' }),
  });
}

// One email when the batch is finished, with a link to each article.
async function ordersDone(ids) {
  const rows = (await q(
    `SELECT o.*, a.slug, a.question, p.title AS podcast, p.dashboard_token, u.email, u.name
     FROM article_orders o LEFT JOIN articles a ON a.id=o.article_id
     JOIN podcasts p ON p.id=o.podcast_id LEFT JOIN users u ON u.id=o.user_id
     WHERE o.id = ANY($1::int[])`, [ids])).rows;
  const to = rows.find((r) => r.email);
  if (!to) return;
  const done = rows.filter((r) => r.status === 'done' && r.slug);
  const failed = rows.filter((r) => r.status === 'failed');
  if (!done.length && !failed.length) return;
  const { subject, html } = mail.articlesReadyEmail({
    name: to.name, podcast: to.podcast, done, failed,
    dashboardUrl: `${process.env.SITE_URL || 'https://podanswer.com'}/dashboard/${to.dashboard_token}`,
  });
  await mail.send({ to: to.email, subject, html, kind: 'articles-ready', userId: to.user_id, podcastId: to.podcast_id });
}

// Make (or a cron) can drain the queue instead of the web process.
app.post('/api/orders/run', jobAuth, wrap(async (req, res) => {
  // Writing moved out of the web process (no AI key is used here). This now only reports the queue.
  const r = await q(`SELECT count(*)::int AS n FROM article_orders WHERE status='queued'`);
  res.json({ ok: true, ran: [], queued: r.rows[0].n, note: 'orders are fulfilled by the daily writer through /api/content/orders' });
}));

// Members who have not picked episodes by grace_days before their period ends get their newest
// episodes queued so the articles they paid for are not lost. No AI involved.
app.post('/api/orders/auto-assign', jobAuth, wrap(async (req, res) => {
  const grace = Math.max(1, parseInt((req.body || {}).grace_days, 10) || 14);
  const subs = (await q(`SELECT s.*, p.slug, p.title FROM subscriptions s JOIN podcasts p ON p.id=s.podcast_id
    WHERE s.status='active' AND s.current_period_end IS NOT NULL AND s.current_period_end <= now() + ($1 || ' days')::interval`, [String(grace)])).rows;
  const out = [];
  for (const sub of subs) {
    const period = periodStart(sub);
    const used = (await q(`SELECT count(*)::int AS n FROM article_orders WHERE podcast_id=$1 AND kind='new' AND status <> 'failed' AND created_at >= $2`, [sub.podcast_id, period])).rows[0].n;
    const left = Math.max(0, sub.quota - used);
    if (!left) continue;
    const eps = (await q(`SELECT e.id FROM episodes e WHERE e.podcast_id=$1
        AND (e.transcript IS NOT NULL OR length(coalesce(e.summary,'')) > 250)
        AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.episode_id=e.id)
        AND NOT EXISTS (SELECT 1 FROM article_orders o WHERE o.episode_id=e.id AND o.status <> 'failed')
      ORDER BY e.published_at DESC NULLS LAST LIMIT $2`, [sub.podcast_id, left])).rows;
    for (const e of eps) {
      const o = (await q(`INSERT INTO article_orders (podcast_id, episode_id, subscription_id, user_id, kind, status, billing_period, note)
        VALUES ($1,$2,$3,$4,'new','queued',$5,'auto-assigned before period end') RETURNING id`, [sub.podcast_id, e.id, sub.id, sub.user_id, period]).rows[0]);
      out.push({ order_id: o.id, podcast: sub.slug, episode_id: e.id });
    }
  }
  res.json({ ok: true, assigned: out });
}));

// Health check for Make's hourly "Health Watch". Returns a summary and emails Sean at most once a day when
// something needs a person: orders waiting more than 2 days, failed orders, a member with no episodes, no GSC data in 10 days.
app.post('/api/health/alert', jobAuth, wrap(async (req, res) => {
  const [stale, failed, members, gsc, dbok] = await Promise.all([
    q(`SELECT count(*)::int AS n FROM article_orders WHERE status='queued' AND created_at < now() - interval '2 days'`),
    q(`SELECT count(*)::int AS n FROM article_orders WHERE status='failed' AND created_at > now() - interval '7 days'`),
    q(`SELECT p.title, (SELECT count(*) FROM episodes e WHERE e.podcast_id=p.id) AS episodes FROM subscriptions s JOIN podcasts p ON p.id=s.podcast_id WHERE s.status='active'`),
    q(`SELECT max(period_start) AS last FROM gsc_rows`).catch(() => ({ rows: [{ last: null }] })),
    q(`SELECT 1`),
  ]);
  const problems = [];
  if (stale.rows[0].n) problems.push(`${stale.rows[0].n} article order(s) have waited more than 2 days`);
  if (failed.rows[0].n) problems.push(`${failed.rows[0].n} article order(s) failed in the last 7 days`);
  for (const m of members.rows) if (!Number(m.episodes)) problems.push(`paying member "${m.title}" has no episodes loaded`);
  const last = gsc.rows[0] && gsc.rows[0].last ? new Date(gsc.rows[0].last) : null;
  if (members.rows.length && (!last || Date.now() - last.getTime() > 10 * 86400000)) problems.push('no Search Console data has arrived in 10 days, so weekly reports will be thin');
  if (!process.env.RESEND_API_KEY) problems.push('RESEND_API_KEY is not set, member emails cannot send');
  const summary = { ok: dbok.rowCount === 1, problems, active_members: members.rows.length, stale_orders: stale.rows[0].n, failed_orders_7d: failed.rows[0].n, last_gsc_period: last };
  if (problems.length && process.env.RESEND_API_KEY) {
    const recent = await q(`SELECT 1 FROM emails WHERE kind='health-alert' AND created_at > now() - interval '24 hours' LIMIT 1`).catch(() => ({ rowCount: 0 }));
    if (!recent.rowCount) {
      const html = `<p>PodAnswer health check found:</p><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p>Checked ${new Date().toUTCString()}.</p>`;
      mail.send({ to: process.env.CONTACT_EMAIL || 'sean@mainstreetmakes.com', subject: `PodAnswer health: ${problems.length} item(s) need a look`, html, kind: 'health-alert' }).catch(() => {});
    }
  }
  res.json(summary);
}));
app.get('/api/health/alert', jobAuth, (req, res) => res.json({ ok: true, note: 'POST for the full check' }));

/* ---------- admin ---------- */
const adminOnly = (req, res, next) => (ADMIN_KEY && req.query.key === ADMIN_KEY ? next() : res.status(404).send(V.notFound()));
app.get('/admin', adminOnly, wrap(async (req, res) => {
  const [leads, pods] = await Promise.all([
    q(`SELECT * FROM leads ORDER BY created_at DESC LIMIT 200`),
    q(`SELECT p.*, (SELECT count(*) FROM articles a WHERE a.podcast_id=p.id)::int AS articles FROM podcasts p ORDER BY p.created_at DESC`),
  ]);
  res.set('Cache-Control', 'no-store');
  res.send(V.admin({ leads: leads.rows, podcasts: pods.rows, key: ADMIN_KEY }));
}));
app.post('/admin/tier', adminOnly, wrap(async (req, res) => {
  const tier = ['listed', 'member', 'studio'].includes(req.body.tier) ? req.body.tier : 'listed';
  await q(`UPDATE podcasts SET tier=$1, updated_at=now() WHERE id=$2`, [tier, parseInt(req.body.id, 10)]);
  res.redirect(`/admin?key=${ADMIN_KEY}`);
}));
app.post('/admin/feature', adminOnly, wrap(async (req, res) => {
  await q(`UPDATE podcasts SET featured = NOT featured WHERE id=$1`, [parseInt(req.body.id, 10)]);
  res.redirect(`/admin?key=${ADMIN_KEY}`);
}));
app.get('/admin/leads.csv', adminOnly, wrap(async (req, res) => {
  const r = await q(`SELECT created_at, name, email, podcast_name, feed_url, plan, message FROM leads ORDER BY created_at DESC`);
  const csv = ['created_at,name,email,podcast_name,feed_url,plan,message', ...r.rows.map((l) => [l.created_at.toISOString(), l.name, l.email, l.podcast_name, l.feed_url, l.plan, l.message].map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');
  res.type('text/csv').send(csv);
}));

/* ---------- SEO plumbing ---------- */
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /dashboard/\nDisallow: /go/\nDisallow: /account\nDisallow: /login\nDisallow: /signup\nDisallow: /api/\nDisallow: /transcripts/\nSitemap: ${V.SITE.url}/sitemap.xml\n`));

app.get('/sitemap.xml', wrap(async (req, res) => {
  const [arts, pods, eps, posts] = await Promise.all([
    q(`SELECT slug, updated_at FROM articles WHERE status='published' ORDER BY updated_at DESC`),
    q(`SELECT slug, updated_at FROM podcasts`),
    q(`SELECT e.slug, p.slug AS pslug, e.created_at FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.transcript IS NOT NULL OR EXISTS (SELECT 1 FROM articles a WHERE a.episode_id=e.id AND a.status='published')`),
    q(`SELECT slug, updated_at FROM blog_posts`),
  ]);
  const u = (loc, lastmod, priority = '0.5', changefreq = 'weekly') => `<url><loc>${esc(V.SITE.url + loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [u('/', null, '1.0', 'daily'), u('/answers', null, '0.9', 'daily'), u('/podcasts', null, '0.8'), u('/topics', null, '0.8', 'daily'), u('/pricing', null, '0.7', 'monthly'), u('/for-podcasters', null, '0.8', 'monthly'), u('/for-studios', null, '0.6', 'monthly'), u('/blog', null, '0.7'), u('/about', null, '0.4', 'monthly'), u('/join', null, '0.6', 'monthly'), u('/terms', null, '0.3', 'monthly'), u('/privacy', null, '0.3', 'monthly'), u('/refunds', null, '0.3', 'monthly'), u('/disclaimer', null, '0.3', 'monthly'),
      ...Object.keys(CATEGORIES).map((c) => u(`/topics/${c}`, null, '0.9', 'daily')),
      ...arts.rows.map((a) => u(`/answers/${a.slug}`, a.updated_at, '0.8')),
      ...posts.rows.map((b) => u(`/blog/${b.slug}`, b.updated_at, '0.7')),
      ...pods.rows.map((p) => u(`/podcasts/${p.slug}`, p.updated_at, '0.6')),
      ...eps.rows.map((e) => u(`/podcasts/${e.pslug}/episodes/${e.slug}`, e.created_at, '0.4', 'monthly')),
    ].join('\n') + `\n</urlset>`;
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(xml);
}));

app.get('/feed.xml', wrap(async (req, res) => {
  const r = await q(`${ARTICLE_SELECT} ORDER BY a.published_at DESC LIMIT 30`);
  const items = r.rows.map((a) => `<item><title>${esc(a.question)}</title><link>${V.SITE.url}/answers/${a.slug}</link><guid>${V.SITE.url}/answers/${a.slug}</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate><description>${esc(a.meta_description || '')}</description></item>`).join('\n');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>PodAnswer: latest answers</title><link>${V.SITE.url}</link><description>${esc(V.SITE.tagline)}</description>${items}</channel></rss>`);
}));

app.get('/health', (req, res) => res.send('ok'));

app.use((req, res) => res.status(404).send(V.notFound()));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).send(V.simple('Something went wrong', '', '/500', '<p>We hit an error. Please try again in a moment.</p>'));
});

// Boot-time self-check. The only way to know a key is right is to use it, and
// this puts the answer in the deploy log instead of in a customer's failed checkout.
async function selfCheck() {
  const line = (k, v) => console.log(`SELFCHECK ${k}: ${v}`);
  if (!process.env.STRIPE_SECRET_KEY) line('stripe', 'no STRIPE_SECRET_KEY set, checkout disabled');
  else {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const acct = await stripe.accounts.retrieve();
      const names = [];
      for (const key of ['STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_NETWORK']) {
        if (!process.env[key]) { names.push(`${key} missing`); continue; }
        const price = await stripe.prices.retrieve(process.env[key]);
        names.push(`${key}=${(price.unit_amount / 100).toFixed(2)} ${price.currency}/${price.recurring ? price.recurring.interval : 'once'}`);
      }
      line('stripe', `ok, account ${acct.id} livemode=${!!acct.charges_enabled && /^(sk|rk)_live/.test(process.env.STRIPE_SECRET_KEY)} | ${names.join(' | ')}`);
    } catch (e) { line('stripe', `FAILED ${e.message}`); }
  }
  line('stripe_webhook_secret', process.env.STRIPE_WEBHOOK_SECRET ? 'set' : 'MISSING');
  line('anthropic', 'not used; articles are written by the daily COO task and published through the content API');
  if (!process.env.RESEND_API_KEY) line('resend', 'MISSING, welcome and weekly emails will not send');
  else {
    try {
      const r = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) line('resend', `FAILED ${j.message || r.status}`);
      else {
        const doms = (j.data || []).map((d) => `${d.name}:${d.status}`).join(' ');
        line('resend', `ok, from=${process.env.MAIL_FROM || 'PodAnswer <reports@podanswer.com>'} domains=[${doms || 'none verified'}]`);
      }
    } catch (e) { line('resend', `FAILED ${e.message}`); }
  }
  line('make_webhook', process.env.MAKE_JOB_WEBHOOK ? 'set' : 'missing');
  line('job_secret', process.env.JOB_SECRET ? 'set' : 'MISSING');
}

const port = process.env.PORT || 3000;
migrate()
  .then(() => app.listen(port, () => { console.log(`PodAnswer listening on ${port}`); selfCheck().catch((e) => console.warn('selfcheck error', e.message)); }))
  .catch((e) => { console.error('migrate failed', e); app.listen(port); });
