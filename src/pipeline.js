// The production line behind a paid subscription:
//   feed -> transcripts -> real search-demand research -> written answers -> published with images
// Called by the job runner (which Make triggers on payment and monthly).
const Anthropic = require('@anthropic-ai/sdk');
const { q } = require('./db');
const { slugify } = require('./util');
const { ingestPodcast } = require('./ingest');
const { articleImage } = require('./images');

const MODEL = process.env.GENERATE_MODEL || 'claude-sonnet-4-5';

/* ---------- 1. search demand ---------- */
// Google's autocomplete endpoint is the cheapest honest signal of what people
// actually type. We expand each seed phrase into real queries people search.
async function suggest(term) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(term)}`, {
      signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 PodAnswerBot/1.0' },
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = JSON.parse(await r.text());
    return Array.isArray(j) && Array.isArray(j[1]) ? j[1] : [];
  } catch { return []; }
}

const PREFIXES = ['how much', 'how do you', 'how long', 'can you', 'is it worth', 'what is', 'why does', 'should i', 'when to', 'what does'];

async function researchQueries(seeds) {
  const out = new Map();
  for (const seed of seeds.slice(0, 8)) {
    const batches = await Promise.all([suggest(seed), ...PREFIXES.slice(0, 5).map((p) => suggest(`${p} ${seed}`))]);
    for (const list of batches) {
      for (const s of list) {
        const k = String(s).toLowerCase().trim();
        if (k.length < 12 || k.length > 90) continue;
        out.set(k, (out.get(k) || 0) + 1);
      }
    }
  }
  // queries that surfaced under more than one seed are the safer bets
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 60);
}

/* ---------- 2. pick the questions this episode can answer ---------- */
async function pickQuestions(client, p, episodes, candidates, existing, n) {
  const eps = episodes.map((e, i) => `[${i}] ${e.title}\n${(e.transcript || e.summary || '').slice(0, 2500)}`).join('\n\n');
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 1500,
    system: 'You match real search queries to podcast episodes that answer them. You are strict: only pair a query with an episode if that episode genuinely answers it in substance. Return JSON only.',
    messages: [{ role: 'user', content:
`Podcast: ${p.title} (${p.category})

EPISODES:
${eps}

REAL SEARCH QUERIES people type (from autocomplete):
${candidates.join('\n')}

ALREADY ANSWERED, do not repeat: ${existing.join(' | ') || 'none'}

Choose the ${n} best pairings. Prefer queries with obvious commercial or practical intent and a clear answer in the episode. Phrase each as a natural question with a capital letter and question mark.
Return JSON: {"picks":[{"question":"...","episodeIndex":0,"whyItFits":"one short line"}]}` }],
  });
  const text = msg.content.map((c) => c.text || '').join('');
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return (j.picks || []).filter((x) => episodes[x.episodeIndex]);
}

/* ---------- 3. write it ---------- */
const WRITE_SYSTEM = `You write answer articles for PodAnswer. Each article answers ONE question people type into Google, using what was said in a specific podcast episode. Rules:
- The reader is a normal person with a problem, not a podcast fan. Answer the question in the first two sentences.
- 700-1000 words. Short direct sentences, contractions, plain English. No em dashes. Never use the phrase "why this matters" or any "why X matters" construction. Headings must be specific, never a restatement of the section's point.
- Quote the transcript verbatim only, each quote under 40 words, with the timestamp if the transcript has one (format "12:40"). If nothing fits, use null.
- Credit the podcast and host by name in the intro. The podcast is the expert. Never send the reader to a competitor.
- Output strict JSON, no markdown fences.`;

const SCHEMA = `{"question":"...","slug":"kebab-case","metaDescription":"under 155 chars","intro":"2-3 sentences answering directly","sections":[{"heading":"...","body":"markdown","quote":{"text":"...","speaker":"...","timestamp":"12:40"}}],"keyTakeaways":["..."],"faq":[{"q":"...","a":"..."}],"sourceNote":"..."}`;

async function writeArticle(client, p, e, question, existing) {
  const source = e.transcript ? `TRANSCRIPT (may be truncated):\n${e.transcript.slice(0, 60000)}` : `SHOW NOTES:\n${e.summary}`;
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 3500, system: WRITE_SYSTEM,
    messages: [{ role: 'user', content:
`Podcast: ${p.title}\nHost: ${p.author || 'the host'}\nTopic: ${p.category}\nEpisode: ${e.title} (published ${e.published_at})\n\nTarget question: ${question}\n\nAlready answered for this show, do not overlap: ${existing.join(' | ') || 'none'}\n\n${source}\n\nWrite the article. JSON only, this schema:\n${SCHEMA}` }],
  });
  const text = msg.content.map((c) => c.text || '').join('');
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const slug = slugify(j.slug || j.question);
  const r = await q(
    `INSERT INTO articles (podcast_id, episode_id, slug, question, meta_description, body, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (slug) DO NOTHING RETURNING id, slug`,
    [p.id, e.id, slug, j.question, (j.metaDescription || '').slice(0, 300),
     JSON.stringify({ intro: j.intro, sections: j.sections || [], keyTakeaways: j.keyTakeaways || [], faq: j.faq || [], sourceNote: j.sourceNote || '' }),
     process.env.GENERATE_STATUS || 'published']
  );
  return r.rows[0] || null;
}

/* ---------- the job ---------- */
async function runJob(jobId) {
  const job = (await q(`SELECT * FROM jobs WHERE id=$1`, [jobId])).rows[0];
  if (!job) throw new Error('job not found');
  if (job.status === 'running' || job.status === 'done') return job;
  await q(`UPDATE jobs SET status='running', started_at=now() WHERE id=$1`, [jobId]);

  try {
    const p = (await q(`SELECT * FROM podcasts WHERE id=$1`, [job.podcast_id])).rows[0];
    if (!p) throw new Error('podcast not found');
    // Paid work never runs against a free listing, checked before anything that costs money.
    // kind 'manual' is the deliberate override.
    if (p.tier === 'listed' && job.kind !== 'manual') throw new Error('free listing: upgrade the show before running paid work');
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    const client = new Anthropic();

    // 1. feed in, transcripts made (ingest handles members only for transcripts)
    await ingestPodcast(p, { limit: 30 });

    const existing = (await q(`SELECT question, episode_id FROM articles WHERE podcast_id=$1`, [p.id])).rows;
    const usedEpisodes = new Set(existing.map((a) => a.episode_id));
    const episodes = (await q(
      `SELECT * FROM episodes WHERE podcast_id=$1 AND (transcript IS NOT NULL OR length(coalesce(summary,'')) > 250)
       ORDER BY published_at DESC NULLS LAST LIMIT 40`, [p.id])).rows;
    if (!episodes.length) throw new Error('no usable episodes yet: feed may have no transcripts or show notes');

    // 2. what are people actually searching for
    const seeds = [p.category.replace('-', ' '), ...episodes.slice(0, 6).map((e) => e.title.split(/[:|,]/)[0].trim())].filter(Boolean);
    const candidates = await researchQueries(seeds);

    // 3. match queries to episodes
    const fresh = episodes.filter((e) => !usedEpisodes.has(e.id));
    const pool = fresh.length >= job.quota ? fresh : episodes;
    const picks = await pickQuestions(client, p, pool.slice(0, 12), candidates, existing.map((a) => a.question), job.quota);

    // 4. write, publish, make the image
    let written = 0;
    const answered = existing.map((a) => a.question);
    for (const pick of picks.slice(0, job.quota)) {
      const e = pool[pick.episodeIndex];
      if (!e) continue;
      try {
        const row = await writeArticle(client, p, e, pick.question, answered);
        if (row) {
          answered.push(pick.question);
          written++;
          articleImage(row.slug).catch(() => {}); // warm the image cache
        }
      } catch (err) { console.warn('write failed', p.slug, pick.question, err.message); }
    }

    await q(`UPDATE jobs SET status='done', finished_at=now(), articles_written=$2, detail=$3 WHERE id=$1`,
      [jobId, written, `${candidates.length} queries researched, ${picks.length} matched, ${written} published`]);
    return (await q(`SELECT * FROM jobs WHERE id=$1`, [jobId])).rows[0];
  } catch (err) {
    await q(`UPDATE jobs SET status='failed', finished_at=now(), detail=$2 WHERE id=$1`, [jobId, String(err.message).slice(0, 500)]);
    alertFailure(jobId, err).catch(() => {});
    throw err;
  }
}

// A paid run that produces nothing has to be noticed, not buried in a log.
async function alertFailure(jobId, err) {
  if (!process.env.MAKE_JOB_WEBHOOK) return;
  const row = (await q(
    `SELECT j.id, j.kind, j.quota, p.title, p.slug, p.tier FROM jobs j LEFT JOIN podcasts p ON p.id=j.podcast_id WHERE j.id=$1`,
    [jobId])).rows[0] || {};
  await fetch(process.env.MAKE_JOB_WEBHOOK, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'job.failed',
      job_id: jobId, kind: row.kind || null, quota: row.quota || null,
      podcast: row.title || null, podcast_slug: row.slug || null, tier: row.tier || null,
      error: String(err.message).slice(0, 300),
      paid: row.tier && row.tier !== 'listed',
      retry_url: `${process.env.SITE_URL || 'https://podanswer.com'}/api/jobs/${jobId}/run`,
      secret: process.env.JOB_SECRET || '',
    }),
  });
}

async function queueJob({ podcastId, subscriptionId, kind, quota }) {
  const r = await q(`INSERT INTO jobs (podcast_id, subscription_id, kind, quota) VALUES ($1,$2,$3,$4) RETURNING *`,
    [podcastId, subscriptionId || null, kind || 'monthly', quota || 4]);
  return r.rows[0];
}

module.exports = { runJob, queueJob, researchQueries };

/* =====================================================================
   Self-serve orders: the member picks episodes, we find the search phrase
   worth targeting and write that one article.
   ===================================================================== */

// Seed phrases straight out of the episode, so autocomplete has something real
// to expand. The model reads the transcript; Google tells us what people type.
async function seedPhrases(client, p, e) {
  const source = e.transcript ? e.transcript.slice(0, 40000) : (e.summary || e.title);
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 600,
    system: 'You extract the searchable subjects inside a podcast episode. Return JSON only.',
    messages: [{ role: 'user', content:
`Podcast: ${p.title} (${p.category})
Episode: ${e.title}

${source}

List 8 short noun phrases a stranger might type into Google because this episode answers it. Two or three words each, no brand names, no episode numbers. Include the episode's main subject and the smaller subjects covered along the way, because a side topic often has far more search demand than the headline.
Return JSON: {"seeds":["...","..."]}` }],
  });
  const t = msg.content.map((c) => c.text || '').join('');
  try { return (JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)).seeds || []).slice(0, 8); }
  catch { return [e.title]; }
}

// One episode, one question. The model weighs the episode's headline subject
// against anything larger buried inside it and picks the one worth ranking for.
async function pickBestQuestion(client, p, e, candidates, existing) {
  const source = e.transcript ? e.transcript.slice(0, 45000) : (e.summary || '');
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 900,
    system: 'You choose which search question a podcast episode should be published against. You are strict: the episode must genuinely answer what you pick. Return JSON only.',
    messages: [{ role: 'user', content:
`Podcast: ${p.title} (${p.category})
Episode: ${e.title}

REAL SEARCHES people type, pulled from Google autocomplete and ranked by how often they surfaced:
${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

EPISODE CONTENT:
${source}

ALREADY PUBLISHED for this show, do not repeat or overlap: ${existing.join(' | ') || 'none'}

Pick the single question this episode should be published against. Two things decide it: how many people search it, and whether the episode answers it in substance. The episode's headline subject is often not the best choice. If a smaller subject covered inside the episode has far more search demand and a real answer in the audio, choose that instead.

Return JSON: {"question":"natural question, capitalised, ends in a question mark","sourceQuery":"the search phrase it targets","angle":"core" or "deeper","reason":"one line on the demand and the answer"}` }],
  });
  const t = msg.content.map((c) => c.text || '').join('');
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  if (!j.question) throw new Error('no question chosen');
  return j;
}

// Replaces the body of an existing article without changing its URL, so the
// page keeps whatever ranking it has earned.
async function rewriteArticle(client, p, e, article, note) {
  const source = e && e.transcript ? `TRANSCRIPT (may be truncated):\n${e.transcript.slice(0, 60000)}` : `SHOW NOTES:\n${e ? e.summary : ''}`;
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 3500, system: WRITE_SYSTEM,
    messages: [{ role: 'user', content:
`Podcast: ${p.title}\nHost: ${p.author || 'the host'}\nTopic: ${p.category}\nEpisode: ${e ? e.title : ''}\n\nTarget question: ${article.question}\n\nThis article already exists and is being rewritten.${note ? ` What the podcaster asked for: ${note}` : ' No specific instruction was given, so make it sharper, more concrete and better organised than a first draft.'}\n\n${source}\n\nWrite the replacement. Keep the same question. JSON only, this schema:\n${SCHEMA}` }],
  });
  const t = msg.content.map((c) => c.text || '').join('');
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  await q(`UPDATE articles SET meta_description=$2, body=$3, rewrites=rewrites+1, updated_at=now() WHERE id=$1`,
    [article.id, (j.metaDescription || '').slice(0, 300),
      JSON.stringify({ intro: j.intro, sections: j.sections || [], keyTakeaways: j.keyTakeaways || [], faq: j.faq || [], sourceNote: j.sourceNote || '' })]);
  await q(`DELETE FROM article_images WHERE article_id=$1`, [article.id]);
  return { id: article.id, slug: article.slug };
}

async function runOrder(orderId) {
  const o = (await q(`SELECT * FROM article_orders WHERE id=$1`, [orderId])).rows[0];
  if (!o) throw new Error('order not found');
  if (['done', 'researching', 'writing'].includes(o.status)) return o;
  if (o.status === 'awaiting_payment') throw new Error('order is not paid');

  const set = (status, patch = {}) => q(
    `UPDATE article_orders SET status=$2, detail=COALESCE($3, detail), article_id=COALESCE($4, article_id),
       target_query=COALESCE($5, target_query), started_at=COALESCE(started_at, now()),
       finished_at=CASE WHEN $2 IN ('done','failed') THEN now() ELSE finished_at END WHERE id=$1`,
    [orderId, status, patch.detail || null, patch.articleId || null, patch.query || null]);

  try {
    await set('researching');
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    const client = new Anthropic();
    const p = (await q(`SELECT * FROM podcasts WHERE id=$1`, [o.podcast_id])).rows[0];
    if (!p) throw new Error('podcast not found');

    // make sure the episode has words in it before anyone reads it
    await ingestPodcast(p, { limit: 30 }).catch((err) => console.warn('ingest note', err.message));
    const e = o.episode_id ? (await q(`SELECT * FROM episodes WHERE id=$1`, [o.episode_id])).rows[0] : null;
    if (!e) throw new Error('episode not found');
    if (!e.transcript && (!e.summary || e.summary.length < 200)) {
      throw new Error('this episode has no transcript and almost no show notes, so there is nothing to write from');
    }

    const existing = (await q(`SELECT question FROM articles WHERE podcast_id=$1 AND removed_at IS NULL`, [p.id])).rows.map((r) => r.question);

    if (o.kind === 'rewrite') {
      const a = (await q(`SELECT * FROM articles WHERE id=$1`, [o.article_id])).rows[0];
      if (!a) throw new Error('article not found');
      await set('writing');
      const row = await rewriteArticle(client, p, e, a, o.note);
      articleImage(row.slug).catch(() => {});
      await set('done', { articleId: row.id });
      return (await q(`SELECT * FROM article_orders WHERE id=$1`, [orderId])).rows[0];
    }

    const seeds = await seedPhrases(client, p, e);
    const candidates = await researchQueries(seeds.length ? seeds : [e.title]);
    if (!candidates.length) candidates.push(e.title.toLowerCase());
    const pick = await pickBestQuestion(client, p, e, candidates.slice(0, 60), existing);

    await set('writing', { query: pick.sourceQuery || pick.question, detail: pick.reason || null });
    const row = await writeArticle(client, p, e, pick.question, existing);
    if (!row) throw new Error('an article with that URL already exists');
    await q(`UPDATE articles SET order_id=$2 WHERE id=$1`, [row.id, orderId]);
    articleImage(row.slug).catch(() => {});
    await set('done', { articleId: row.id });
    return (await q(`SELECT * FROM article_orders WHERE id=$1`, [orderId])).rows[0];
  } catch (err) {
    await q(`UPDATE article_orders SET status='failed', detail=$2, finished_at=now() WHERE id=$1`, [orderId, err.message]);
    throw err;
  }
}

// Everything queued, oldest first. Called by Make and by the request form.
async function runDueOrders(limit = 5) {
  const rows = (await q(`SELECT id FROM article_orders WHERE status='queued' ORDER BY created_at LIMIT $1`, [limit])).rows;
  const out = [];
  for (const r of rows) {
    try { const o = await runOrder(r.id); out.push({ id: r.id, status: o.status, article_id: o.article_id }); }
    catch (e) { out.push({ id: r.id, status: 'failed', error: e.message }); }
  }
  return out;
}

module.exports.seedPhrases = seedPhrases;
module.exports.pickBestQuestion = pickBestQuestion;
module.exports.rewriteArticle = rewriteArticle;
module.exports.runOrder = runOrder;
module.exports.runDueOrders = runDueOrders;
