// Writes answer articles for member podcasts from episode transcripts.
// Requires ANTHROPIC_API_KEY. Run on a schedule or by hand:
//   node src/generate.js                 -> up to GENERATE_BATCH articles across members
//   node src/generate.js <podcast-slug>  -> only that podcast
//   node src/generate.js <podcast-slug> <n> -> n articles for that podcast
// Cost: roughly 2 to 5 cents per article with claude-sonnet.
const Anthropic = require('@anthropic-ai/sdk');
const { q, pool } = require('./db');
const { slugify } = require('./util');

const MODEL = process.env.GENERATE_MODEL || 'claude-sonnet-4-5';
const BATCH = parseInt(process.env.GENERATE_BATCH || '10', 10);

const SYSTEM = `You write answer articles for PodAnswer, a podcast network site. Each article answers ONE real question people type into Google, using what was said in a specific podcast episode. Rules:
- Title is a natural search question (e.g. "How much should a plumber charge per hour?").
- 600-900 words. Short direct sentences, contractions, plain English. No em dashes anywhere. Never use the phrase "why this matters" or "why X matters". Headings must be specific, not a restatement of the point.
- Quote the transcript verbatim only. Each quote under 40 words. Use null for quote if nothing fits.
- Credit the podcast and host by name in the intro. The podcast is the expert; never send readers to other shows or sources.
- Output strict JSON matching the schema. No markdown fences.`;

const SCHEMA = `{"question":"...","slug":"kebab-case-of-question","metaDescription":"under 155 chars","intro":"2-3 sentences answering directly","sections":[{"heading":"...","body":"markdown","quote":{"text":"...","speaker":"...","timestamp":""}}],"keyTakeaways":["..."],"faq":[{"q":"...","a":"..."}],"sourceNote":"..."}`;

async function generateOne(client, p, e, existingQuestions) {
  const source = e.transcript ? `TRANSCRIPT (may be truncated):\n${e.transcript.slice(0, 60000)}` : `SHOW NOTES:\n${e.summary}`;
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 3000, system: SYSTEM,
    messages: [{ role: 'user', content: `Podcast: ${p.title}\nHost: ${p.author || 'the host'}\nCategory: ${p.category}\nEpisode: ${e.title} (published ${e.published_at})\n\nAlready-answered questions for this show (do not repeat): ${existingQuestions.join(' | ') || 'none'}\n\n${source}\n\nPick the single most searched question this episode clearly answers and write the article. Return JSON only with this schema:\n${SCHEMA}` }],
  });
  const text = msg.content.map((c) => c.text || '').join('');
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const slug = slugify(j.slug || j.question);
  await q(
    `INSERT INTO articles (podcast_id, episode_id, slug, question, meta_description, body, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (slug) DO NOTHING`,
    [p.id, e.id, slug, j.question, j.metaDescription || '', JSON.stringify({ intro: j.intro, sections: j.sections || [], keyTakeaways: j.keyTakeaways || [], faq: j.faq || [], sourceNote: j.sourceNote || '' }), process.env.GENERATE_STATUS || 'published']
  );
  return slug;
}

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
  const client = new Anthropic();
  const only = process.argv[2];
  const perPodcast = parseInt(process.argv[3] || '0', 10);
  const pods = (await q(`SELECT * FROM podcasts WHERE ${only ? 'slug=$1' : "tier <> 'listed'"}`, only ? [only] : [])).rows;
  let written = 0;
  for (const p of pods) {
    const existing = (await q(`SELECT question, episode_id FROM articles WHERE podcast_id=$1`, [p.id])).rows;
    const usedEpisodes = new Set(existing.map((a) => a.episode_id));
    const eps = (await q(`SELECT * FROM episodes WHERE podcast_id=$1 AND (transcript IS NOT NULL OR length(summary) > 300) ORDER BY published_at DESC`, [p.id])).rows.filter((e) => !usedEpisodes.has(e.id));
    const n = perPodcast || Math.max(0, BATCH - written);
    for (const e of eps.slice(0, n)) {
      try {
        const slug = await generateOne(client, p, e, existing.map((a) => a.question));
        console.log('wrote', p.slug, slug);
        written++;
      } catch (err) { console.warn('generate failed', p.slug, e.title, err.message); }
      if (!perPodcast && written >= BATCH) break;
    }
    if (!perPodcast && written >= BATCH) break;
  }
  console.log(`generated ${written} articles`);
}

if (require.main === module) run().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
