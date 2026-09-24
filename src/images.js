// Every published answer gets its own branded image: used as the article hero
// and as the og:image, so shares and Google Discover have something to show.
// Generated once on first request, then cached in Postgres.
const sharp = require('sharp');
const { q } = require('./db');
const { esc } = require('./util');

const W = 1200, H = 630;
const NAVY = '#0c1830', BLUE = '#1160d8';

function wrap(text, perLine, maxLines) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur + ' ' + w).trim();
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur.trim());
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[,.;:]?$/, '') + '…';
  }
  return lines;
}

async function fetchArtwork(url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'PodAnswerBot/1.0 (+https://podanswer.com)' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return await sharp(buf).resize(300, 300, { fit: 'cover' }).png().toBuffer();
  } catch { return null; }
}

function clip(s, n) {
  const t = String(s || '');
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,:;.-]+$/, '') + '…';
}

const CW = 0.60; // DejaVu Sans Bold average glyph width, in em

function fitText(text, boxW, maxLines) {
  for (let size = 68; size >= 34; size -= 2) {
    const perLine = Math.floor(boxW / (size * CW));
    const lines = wrap(text, perLine, maxLines);
    const longest = Math.max(...lines.map((l) => l.length), 1);
    if (lines.length <= maxLines && longest * size * CW <= boxW) return { size, lines };
  }
  return { size: 34, lines: wrap(text, Math.floor(boxW / (34 * CW)), maxLines) };
}

function svgCard({ question, showTitle, author, topic, hasArt }) {
  const boxW = hasArt ? 690 : 1030;
  const { size, lines } = fitText(question, boxW, 4);
  const startY = 200 + size;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eaf1fd"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="10" fill="${BLUE}"/>
  <text x="80" y="128" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="26" font-weight="bold" fill="${BLUE}" letter-spacing="2">${esc(String(topic || '').toUpperCase())}</text>
  ${lines.map((l, i) => `<text x="80" y="${startY + i * size * 1.2}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="bold" fill="${NAVY}">${esc(l)}</text>`).join('\n  ')}
  <rect x="80" y="${H - 150}" width="${boxW}" height="2" fill="#cdd9ec"/>
  <text x="80" y="${H - 100}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="29" font-weight="bold" fill="${NAVY}">${esc(clip(showTitle, hasArt ? 32 : 48))}</text>
  <text x="80" y="${H - 58}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="24" fill="#68758c">${esc(author ? clip(author, 30) + '  ·  ' : '')}podanswer.com</text>
</svg>`);
}

async function buildImage({ question, showTitle, author, topic, artworkUrl }) {
  const art = await fetchArtwork(artworkUrl);
  const base = sharp(svgCard({ question, showTitle, author, topic, hasArt: !!art }));
  if (!art) return base.png({ compressionLevel: 9 }).toBuffer();
  const rounded = await sharp(art)
    .composite([{ input: Buffer.from(`<svg><rect x="0" y="0" width="300" height="300" rx="28" ry="28"/></svg>`), blend: 'dest-in' }])
    .png().toBuffer();
  return base.composite([{ input: rounded, top: 165, left: 830 }]).png({ compressionLevel: 9 }).toBuffer();
}

// Returns a PNG buffer for an article, generating and caching it if needed.
async function articleImage(slug) {
  const r = await q(
    `SELECT a.id, a.question, p.title AS show_title, p.author, p.category, p.image_url,
            (SELECT png FROM article_images i WHERE i.article_id = a.id) AS png
     FROM articles a JOIN podcasts p ON p.id = a.podcast_id WHERE a.slug = $1`, [slug]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.png) return row.png;
  const { CATEGORIES } = require('./util');
  const png = await buildImage({
    question: row.question, showTitle: row.show_title, author: row.author,
    topic: (CATEGORIES[row.category] || {}).name || row.category, artworkUrl: row.image_url,
  });
  await q(`INSERT INTO article_images (article_id, png) VALUES ($1,$2) ON CONFLICT (article_id) DO UPDATE SET png=EXCLUDED.png`, [row.id, png]).catch(() => {});
  return png;
}

// Blog posts get the same treatment so every share and search result has a card.
async function blogImage(slug) {
  const r = await q(
    `SELECT b.slug, b.title, (SELECT png FROM blog_images i WHERE i.slug = b.slug) AS png
     FROM blog_posts b WHERE b.slug = $1`, [slug]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.png) return row.png;
  const png = await buildImage({
    question: row.title, showTitle: 'PodAnswer', author: 'Podcast growth', topic: 'For podcasters', artworkUrl: null,
  });
  await q(`INSERT INTO blog_images (slug, png) VALUES ($1,$2) ON CONFLICT (slug) DO UPDATE SET png=EXCLUDED.png`, [row.slug, png]).catch(() => {});
  return png;
}

const invalidate = (articleId) => q(`DELETE FROM article_images WHERE article_id=$1`, [articleId]).catch(() => {});

module.exports = { articleImage, blogImage, buildImage, invalidate };
