// Loads data/seed/podcasts/*.json and data/seed/blog/*.md into the database.
// Idempotent: upserts by slug. Safe to run on every deploy.
const fs = require('fs');
const path = require('path');
const { q, pool, migrate } = require('./db');
const { slugify, token } = require('./util');

async function upsertPodcast(p) {
  const r = await q(
    `INSERT INTO podcasts (slug, title, author, description, category, website, feed_url, image_url, apple_url, spotify_url, youtube_url, tier, featured, dashboard_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (slug) DO UPDATE SET
       title=EXCLUDED.title, author=EXCLUDED.author, description=EXCLUDED.description, category=EXCLUDED.category,
       website=EXCLUDED.website, feed_url=EXCLUDED.feed_url, image_url=EXCLUDED.image_url,
       apple_url=COALESCE(NULLIF(EXCLUDED.apple_url,''), podcasts.apple_url),
       spotify_url=COALESCE(NULLIF(EXCLUDED.spotify_url,''), podcasts.spotify_url),
       youtube_url=COALESCE(NULLIF(EXCLUDED.youtube_url,''), podcasts.youtube_url),
       updated_at=now()
     RETURNING id, dashboard_token`,
    [p.slug, p.title, p.author || '', p.description || '', p.category, p.website || '', p.feedUrl || '', p.imageUrl || '',
     p.appleUrl || '', p.spotifyUrl || '', p.youtubeUrl || '', p.tier || 'listed', !!p.featured, token()]
  );
  return r.rows[0].id;
}

async function upsertEpisode(podcastId, e) {
  const slug = slugify(e.title) || slugify(e.guid);
  const r = await q(
    `INSERT INTO episodes (podcast_id, guid, slug, title, published_at, summary, audio_url, duration_sec, episode_url, transcript_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (podcast_id, guid) DO UPDATE SET
       title=EXCLUDED.title, published_at=EXCLUDED.published_at, summary=EXCLUDED.summary, audio_url=EXCLUDED.audio_url,
       duration_sec=EXCLUDED.duration_sec, episode_url=EXCLUDED.episode_url, transcript_url=EXCLUDED.transcript_url
     RETURNING id`,
    [podcastId, e.guid, slug, e.title, e.publishedAt || null, e.summary || '', e.audioUrl || '', e.durationSec || null, e.episodeUrl || '', e.transcriptUrl || '']
  ).catch(async (err) => {
    // slug collision within same podcast: append guid suffix
    if (String(err.message).includes('episodes_podcast_id_slug_key')) {
      return q(
        `INSERT INTO episodes (podcast_id, guid, slug, title, published_at, summary, audio_url, duration_sec, episode_url, transcript_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (podcast_id, guid) DO UPDATE SET title=EXCLUDED.title RETURNING id`,
        [podcastId, e.guid, slug + '-' + slugify(e.guid).slice(-8), e.title, e.publishedAt || null, e.summary || '', e.audioUrl || '', e.durationSec || null, e.episodeUrl || '', e.transcriptUrl || '']
      );
    }
    throw err;
  });
  return r.rows[0].id;
}

async function upsertArticle(podcastId, episodeIds, a) {
  const body = {
    intro: a.intro || '',
    sections: a.sections || [],
    keyTakeaways: a.keyTakeaways || [],
    faq: a.faq || [],
    sourceNote: a.sourceNote || '',
  };
  await q(
    `INSERT INTO articles (podcast_id, episode_id, slug, question, meta_description, body, published_at)
     VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, now()))
     ON CONFLICT (slug) DO UPDATE SET
       podcast_id=EXCLUDED.podcast_id, episode_id=EXCLUDED.episode_id, question=EXCLUDED.question,
       meta_description=EXCLUDED.meta_description, body=EXCLUDED.body, updated_at=now()`,
    [podcastId, episodeIds[a.episodeGuid] || null, a.slug || slugify(a.question), a.question, a.metaDescription || '', JSON.stringify(body), a.publishedAt || null]
  );
}

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return { meta, body: m[2] };
}

async function run() {
  await migrate();
  const dir = path.join(__dirname, '..', 'data', 'seed', 'podcasts');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  let pods = 0, eps = 0, arts = 0;
  for (const f of files) {
    let p;
    try { p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { console.warn('skip', f, e.message); continue; }
    if (!p.slug || !p.title || !p.category) { console.warn('skip incomplete', f); continue; }
    const id = await upsertPodcast(p);
    pods++;
    const episodeIds = {};
    for (const e of p.episodes || []) {
      if (!e.guid || !e.title) continue;
      episodeIds[e.guid] = await upsertEpisode(id, e);
      eps++;
    }
    for (const a of p.articles || []) {
      if (!a.question) continue;
      await upsertArticle(id, episodeIds, a);
      arts++;
    }
  }
  const bdir = path.join(__dirname, '..', 'data', 'seed', 'blog');
  const bfiles = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((f) => f.endsWith('.md')) : [];
  let posts = 0;
  for (const f of bfiles) {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(bdir, f), 'utf8'));
    const slug = meta.slug || f.replace(/\.md$/, '');
    if (!meta.title) continue;
    await q(
      `INSERT INTO blog_posts (slug, title, meta_description, body_md, published_at)
       VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, meta_description=EXCLUDED.meta_description, body_md=EXCLUDED.body_md, updated_at=now()`,
      [slug, meta.title, meta.description || '', body, meta.date || null]
    );
    posts++;
  }
  // Retire blog posts whose markdown file no longer exists, so an old post
  // never competes with the article that replaced it.
  const keep = bfiles.map((f) => f.replace(/\.md$/, ''));
  const metaSlugs = [];
  for (const f of bfiles) {
    const { meta } = parseFrontmatter(fs.readFileSync(path.join(bdir, f), 'utf8'));
    metaSlugs.push(meta.slug || f.replace(/\.md$/, ''));
  }
  const live = [...new Set([...keep, ...metaSlugs])];
  if (live.length) {
    const gone = await q(`DELETE FROM blog_posts WHERE slug <> ALL($1::text[]) RETURNING slug`, [live]);
    if (gone.rows.length) console.log('retired blog posts:', gone.rows.map((r) => r.slug).join(', '));
  }
  console.log(`seeded ${pods} podcasts, ${eps} episodes, ${arts} articles, ${posts} blog posts`);
}

if (require.main === module) {
  run().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { run };
