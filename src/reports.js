// Weekly member reporting.
//
// Google Search Console owns the impression and click numbers, and it will not
// hand them to a server without an OAuth identity, so Make holds the Google
// connection and posts the rows here every Monday. We store them, attach each
// page to the show it belongs to, and send each paying member their week.
const { q } = require('./db');
const mail = require('./mail');

const SITE = process.env.SITE_URL || 'https://podanswer.com';

const iso = (d) => new Date(d).toISOString().slice(0, 10);

// Last completed Monday-to-Sunday week, in UTC.
function lastWeek(ref) {
  const end = new Date(ref || Date.now());
  end.setUTCHours(0, 0, 0, 0);
  const back = (end.getUTCDay() + 6) % 7; // days since Monday
  end.setUTCDate(end.getUTCDate() - back - 1); // previous Sunday
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: iso(start), end: iso(end) };
}

function prevWeek(startIso) {
  const s = new Date(`${startIso}T00:00:00Z`);
  const e = new Date(s); e.setUTCDate(e.getUTCDate() - 1);
  const p = new Date(s); p.setUTCDate(p.getUTCDate() - 7);
  return { start: iso(p), end: iso(e) };
}

function periodLabel(start, end) {
  const f = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(start)} to ${f(end)}`;
}

// "https://podanswer.com/answers/what-does-a-kitchen-remodel-cost?x=1" -> the slug
function pathOf(page) {
  try { return new URL(page).pathname.replace(/\/+$/, '') || '/'; }
  catch { return String(page || '').split('?')[0].replace(/\/+$/, '') || '/'; }
}

/* ---------- 1. take the rows Make pulled from Search Console ---------- */
async function ingestGsc({ start, end, rows }) {
  if (!start || !end) throw new Error('start and end are required (YYYY-MM-DD)');
  if (!Array.isArray(rows)) throw new Error('rows must be an array');

  // one lookup instead of a query per row
  const arts = (await q(`SELECT id, slug, podcast_id FROM articles`)).rows;
  const byArticle = new Map(arts.map((a) => [`/answers/${a.slug}`, a]));
  const pods = (await q(`SELECT id, slug FROM podcasts`)).rows;
  const byPodcast = new Map(pods.map((p) => [`/podcasts/${p.slug}`, p]));

  let stored = 0, matched = 0;
  for (const r of rows) {
    const page = String(r.page || r.keys?.[0] || '').trim();
    if (!page) continue;
    const path = pathOf(page);
    const a = byArticle.get(path);
    const p = a ? { id: a.podcast_id } : byPodcast.get(path);
    const query = String(r.query || r.keys?.[1] || '').slice(0, 300);
    await q(
      `INSERT INTO gsc_rows (period_start, period_end, page, query, clicks, impressions, position, podcast_id, article_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (period_start, page, query) DO UPDATE SET
         clicks=EXCLUDED.clicks, impressions=EXCLUDED.impressions, position=EXCLUDED.position,
         period_end=EXCLUDED.period_end, podcast_id=EXCLUDED.podcast_id, article_id=EXCLUDED.article_id`,
      [start, end, path, query, Math.round(r.clicks || 0), Math.round(r.impressions || 0),
        r.position != null ? Number(r.position).toFixed(2) : null, p ? p.id : null, a ? a.id : null]);
    stored++;
    if (p) matched++;
  }
  return { stored, matched, start, end };
}

/* ---------- 2. build one member's week ---------- */
async function weekFor(podcast, start, end) {
  const prev = prevWeek(start);
  const [totals, prevTotals, pages, queries, platforms, arts] = await Promise.all([
    q(`SELECT COALESCE(SUM(clicks),0)::int AS clicks, COALESCE(SUM(impressions),0)::int AS impressions,
              AVG(position) FILTER (WHERE impressions > 0) AS position
       FROM gsc_rows WHERE podcast_id=$1 AND period_start=$2 AND query=''`, [podcast.id, start]),
    q(`SELECT COALESCE(SUM(clicks),0)::int AS clicks, COALESCE(SUM(impressions),0)::int AS impressions
       FROM gsc_rows WHERE podcast_id=$1 AND period_start=$2 AND query=''`, [podcast.id, prev.start]),
    q(`SELECT g.impressions, g.clicks, a.slug, a.question
       FROM gsc_rows g JOIN articles a ON a.id = g.article_id
       WHERE g.podcast_id=$1 AND g.period_start=$2 AND g.query=''
       ORDER BY g.impressions DESC LIMIT 5`, [podcast.id, start]),
    q(`SELECT query, SUM(impressions)::int AS impressions, SUM(clicks)::int AS clicks
       FROM gsc_rows WHERE podcast_id=$1 AND period_start=$2 AND query <> ''
       GROUP BY query ORDER BY impressions DESC LIMIT 8`, [podcast.id, start]),
    q(`SELECT platform, count(*)::int AS clicks FROM clicks
       WHERE podcast_id=$1 AND created_at >= $2::date AND created_at < ($3::date + 1)
       GROUP BY platform ORDER BY clicks DESC`, [podcast.id, start, end]),
    q(`SELECT count(*)::int AS total,
              count(*) FILTER (WHERE published_at >= $2::date AND published_at < ($3::date + 1))::int AS fresh
       FROM articles WHERE podcast_id=$1 AND status='published'`, [podcast.id, start, end]),
  ]);

  const t = totals.rows[0], pt = prevTotals.rows[0], a = arts.rows[0];
  return {
    podcast: podcast.title,
    periodLabel: periodLabel(start, end),
    impressions: t.impressions, clicks: t.clicks,
    position: t.position,
    prevImpressions: pt.impressions, prevClicks: pt.clicks,
    listenClicks: platforms.rows.reduce((n, r) => n + r.clicks, 0),
    topPages: pages.rows, topQueries: queries.rows, platforms: platforms.rows,
    newArticles: a.fresh, totalArticles: a.total,
    dashboardUrl: `${SITE}/dashboard/${podcast.dashboard_token}`,
    optOutUrl: `${SITE}/reports/off/${podcast.dashboard_token}`,
  };
}

/* ---------- 3. send the week to everyone still paying ---------- */
async function sendWeekly({ start, end, dryRun, onlySlug } = {}) {
  const week = start && end ? { start, end } : lastWeek();
  const members = (await q(
    `SELECT DISTINCT ON (p.id) p.*, u.id AS uid, u.email AS user_email, u.name AS user_name, u.report_opt_out, s.status
     FROM subscriptions s
     JOIN podcasts p ON p.id = s.podcast_id
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.status = 'active' ${onlySlug ? 'AND p.slug = $1' : ''}
     ORDER BY p.id, s.updated_at DESC`, onlySlug ? [onlySlug] : [])).rows;

  const out = [];
  for (const m of members) {
    const to = m.user_email || m.owner_email;
    if (!to) { out.push({ podcast: m.title, skipped: 'no email on file' }); continue; }
    if (m.report_opt_out) { out.push({ podcast: m.title, skipped: 'opted out' }); continue; }

    const already = (await q(
      `SELECT 1 FROM emails WHERE kind='weekly' AND podcast_id=$1 AND period_start=$2 AND status='sent'`,
      [m.id, week.start])).rows.length;
    if (already && !dryRun) { out.push({ podcast: m.title, skipped: 'already sent' }); continue; }

    const data = await weekFor(m, week.start, week.end);
    const { subject, html } = mail.weeklyEmail(data);
    if (dryRun) { out.push({ podcast: m.title, to, subject, impressions: data.impressions, clicks: data.clicks, html }); continue; }
    const r = await mail.send({ to, subject, html, kind: 'weekly', userId: m.uid, podcastId: m.id, periodStart: week.start });
    out.push({ podcast: m.title, to, subject, sent: r.ok, error: r.error });
  }
  return { period: week, count: out.length, results: out };
}

/* ---------- 4. the thank-you that goes out on purchase ---------- */
async function sendWelcome({ user, podcast, plan, quota }) {
  const to = (user && user.email) || (podcast && podcast.owner_email);
  if (!to) return { ok: false, error: 'no email on file' };
  const { subject, html } = mail.welcomeEmail({
    name: (user && user.name) || '',
    podcast: podcast ? podcast.title : '',
    plan: plan === 'network' ? 'Network' : 'Growth',
    quota: quota || 4,
    dashboardUrl: podcast && podcast.dashboard_token ? `${SITE}/dashboard/${podcast.dashboard_token}` : `${SITE}/account`,
  });
  return mail.send({ to, subject, html, kind: 'welcome', userId: user ? user.id : null, podcastId: podcast ? podcast.id : null });
}

module.exports = { ingestGsc, sendWeekly, sendWelcome, weekFor, lastWeek, prevWeek, pathOf };
