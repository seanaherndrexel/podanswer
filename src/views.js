const { marked } = require('marked');
const { CATEGORIES, esc, fmtDate, fmtDuration } = require('./util');

const SITE = {
  name: 'PodAnswer',
  url: process.env.SITE_URL || 'https://podanswer.com',
  tagline: 'Answers from the people who do the work, taken from the podcasts where they said it.',
  email: process.env.CONTACT_EMAIL || 'sean@mainstreetmakes.com',
  gaId: process.env.GA_MEASUREMENT_ID || '',
  gscToken: process.env.GSC_VERIFICATION || '',
};

const PLATFORM_LABEL = { apple: 'Apple Podcasts', spotify: 'Spotify', youtube: 'YouTube', website: 'Your own site', site: 'Your own site', overcast: 'Overcast', pocketcasts: 'Pocket Casts' };

const md = (s) => marked.parse(String(s || ''), { mangle: false, headerIds: false });

// "12:40" or "1:02:30" -> seconds
function tsToSeconds(t) {
  if (!t) return null;
  const parts = String(t).trim().split(':').map(Number);
  if (!parts.length || parts.some(isNaN)) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

// Breadcrumbs tell Google which silo a page belongs to, on every page that has a parent.
function crumbs(items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: SITE.url + it.path })),
  };
}

function layout({ title, description, path = '/', body, jsonld = [], ogImage, noindex = false, canonical }) {
  const fullTitle = title ? `${title} | ${SITE.name}` : `${SITE.name}: answers from the experts who said them`;
  const url = canonical || SITE.url + path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || SITE.tagline)}">
<link rel="canonical" href="${esc(url)}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(title || SITE.name)}">
<meta property="og:description" content="${esc(description || SITE.tagline)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:type" content="${path.startsWith('/answers/') || path.startsWith('/blog/') ? 'article' : 'website'}">
<meta property="og:image" content="${esc(ogImage || SITE.url + '/og.png')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title || SITE.name)}">
<meta name="twitter:description" content="${esc(description || SITE.tagline)}">
<meta name="twitter:image" content="${esc(ogImage || SITE.url + '/og.png')}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_US">
<meta name="theme-color" content="#1668e3">
${SITE.gscToken ? `<meta name="google-site-verification" content="${esc(SITE.gscToken)}">` : ''}
<link rel="icon" href="/mark.png" type="image/png">
<link rel="apple-touch-icon" href="/mark.png">
<link rel="alternate" type="application/rss+xml" title="PodAnswer: newest answers" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css?v=11">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
${SITE.gaId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(SITE.gaId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(SITE.gaId)}');</script>` : ''}
</head>
<body>
<header class="nav">
  <div class="wrap nav-in">
    <a class="logo" href="/"><img src="/logo.png?v=2" alt="PodAnswer" width="250" height="51"></a>
    <nav class="nav-links">
      <a href="/answers">Answers</a>
      <a href="/topics">Topics</a>
      <a href="/podcasts">Podcasts</a>
      <a href="/blog">Blog</a>
    </nav>
    <div class="nav-cta">
      <a class="btn btn-ghost" href="/for-podcasters">For podcasters</a>
      <a class="btn btn-primary" href="/answers">Find an answer</a>
    </div>
    <button class="nav-toggle" aria-label="Menu" onclick="document.body.classList.toggle('nav-open')">☰</button>
  </div>
</header>
<main>${body}</main>
<footer class="footer">
  <div class="wrap footer-grid">
    <div>
      <a class="logo" href="/"><img src="/logo.png?v=2" alt="PodAnswer" width="250" height="51"></a>
      <p class="muted">Somebody already answered your question out loud. We find the moment, write it down, and point you to the exact minute so you can hear it yourself.</p>
      <p class="muted small">A Main Street Creative company. Doylestown, PA.</p>
    </div>
    <div>
      <h4>Browse</h4>
      <a href="/answers">All answers</a>
      <a href="/topics">Topics</a>
      <a href="/podcasts">Podcasts</a>
      ${Object.entries(CATEGORIES).slice(0, 5).map(([k, v]) => `<a href="/topics/${k}">${esc(v.name)}</a>`).join('')}
    </div>
    <div>
      <h4>Podcasters</h4>
      <a href="/for-podcasters">How the network works</a>
      <a href="/pricing">Pricing</a>
      <a href="/signup">Add your show</a>
      <a href="/for-studios">Studios and agencies</a>
      <a href="/account">Your account</a>
      <a href="/blog">Growth blog</a>
    </div>
    <div>
      <h4>Company</h4>
      <a href="/about">About</a>
      <a href="mailto:${esc(SITE.email)}">Contact</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/refunds">Refunds</a>
      <a href="/disclaimer">Disclaimer</a>
      <a href="/feed.xml">RSS</a>
    </div>
  </div>
  <div class="wrap footer-bottom muted small">© ${new Date().getFullYear()} PodAnswer · Mini Machine Creative LLC. Podcast artwork and audio belong to their creators.</div>
</footer>
<script src="/app.js?v=9" defer></script>
</body>
</html>`;
}

/* ---------- partials ---------- */

function podcastCard(p, { showCategory = true } = {}) {
  return `<a class="card pod-card" href="/podcasts/${esc(p.slug)}">
    <img loading="lazy" src="${esc(p.image_url || '/placeholder.svg')}" alt="${esc(p.title)} artwork" width="96" height="96" onerror="this.src='/placeholder.svg'">
    <div>
      <h3>${esc(p.title)}</h3>
      <p class="muted small">${esc(p.author || '')}</p>
      ${showCategory && CATEGORIES[p.category] ? `<span class="chip">${esc(CATEGORIES[p.category].name)}</span>` : ''}
    </div>
  </a>`;
}

function articleCard(a) {
  return `<a class="card art-card" href="/answers/${esc(a.slug)}">
    <h3>${esc(a.question)}</h3>
    <p class="muted">${esc(a.meta_description || '')}</p>
    <div class="art-card-foot">
      <img loading="lazy" src="${esc(a.image_url || '/placeholder.svg')}" alt="" width="26" height="26" onerror="this.src='/placeholder.svg'">
      <span class="small muted">Answered on ${esc(a.podcast_title)}</span>
    </div>
  </a>`;
}

function listenButtons(p, articleId, { label = '' } = {}) {
  const base = `/go/${esc(p.slug)}/`;
  const qs = articleId ? `?a=${articleId}` : '';
  const btns = [];
  if (p.apple_url) btns.push(`<a class="btn btn-listen" rel="nofollow" href="${base}apple${qs}">Apple Podcasts</a>`);
  if (p.spotify_url) btns.push(`<a class="btn btn-listen" rel="nofollow" href="${base}spotify${qs}">Spotify</a>`);
  if (p.youtube_url) btns.push(`<a class="btn btn-listen" rel="nofollow" href="${base}youtube${qs}">YouTube</a>`);
  if (p.website) btns.push(`<a class="btn btn-listen" rel="nofollow" href="${base}website${qs}">Show website</a>`);
  if (p.feed_url) btns.push(`<a class="btn btn-listen" rel="nofollow" href="${base}rss${qs}">RSS</a>`);
  return `${label ? `<p class="small listen-label">${esc(label)}</p>` : ''}<div class="listen">${btns.join('')}</div>`;
}

function categoryGrid(counts = {}) {
  return `<div class="cat-grid">${Object.entries(CATEGORIES).map(([k, v]) => `
    <a class="cat" href="/topics/${k}">
      <strong>${esc(v.name)}</strong>
      <span class="muted small">${esc(v.blurb)}</span>
      ${counts[k] ? `<span class="cat-n">${counts[k]} show${counts[k] === 1 ? '' : 's'}</span>` : ''}
    </a>`).join('')}</div>`;
}

/* ---------- pages ---------- */

function home({ stats, featuredArticles, featuredPodcasts, counts }) {
  const body = `
<section class="hero">
  <div class="wrap hero-in">
    <h1>Complicated questions are best answered <em>with podcasts.</em></h1>
    <p class="lead">Match your question to a podcast episode that answers it, right down to the exact segment of the show. Search, listen and learn with PodAnswer.</p>
    <form class="search search-hero" action="/answers" method="get">
      <input type="search" name="q" placeholder="How much should a plumber charge per hour?" aria-label="Search answers">
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
    <p class="muted small">Free to use forever</p>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head">
      <h2>Recently answered</h2>
      <a class="link" href="/answers">See all →</a>
    </div>
    <div class="grid-3">${featuredArticles.map(articleCard).join('')}</div>
  </div>
</section>

<section class="section section-alt">
  <div class="wrap">
    <div class="section-head"><h2>Read it, or hear the person say it</h2></div>
    <div class="how3">
      <div class="how-step"><span class="num">1</span><h3>Ask the way you'd ask a friend</h3><p>Plain questions work best. You do not need keywords or jargon, and you will not be reading a forum thread from 2014.</p></div>
      <div class="how-step"><span class="num">2</span><h3>Get the answer in writing</h3><p>The full answer, in order, with the expert's own words quoted and who they are made clear.</p></div>
      <div class="how-step"><span class="num">3</span><h3>Jump to the exact minute</h3><p>Every quote carries a timestamp. Press play and you're at the moment they said it, not the start of a two hour episode.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head"><h2>What people are asking about</h2><a class="link" href="/topics">All topics →</a></div>
    ${categoryGrid(counts)}
  </div>
</section>

<section class="section section-alt">
  <div class="wrap">
    <div class="section-head"><h2>Shows the answers come from</h2><a class="link" href="/podcasts">All shows →</a></div>
    <div class="grid-4">${featuredPodcasts.map((p) => podcastCard(p)).join('')}</div>
  </div>
</section>

<section class="section cta-band">
  <div class="wrap cta-in">
    <h2>Host a podcast?</h2>
    <p>The people finding these answers are finding the shows behind them. Here's how your episodes get added.</p>
    <a class="btn btn-light btn-lg" href="/for-podcasters">See how the network works</a>
  </div>
</section>`;
  return layout({
    title: '',
    description: 'Ask a real question and get a straight answer from someone who does the work, written out and timestamped to the podcast moment where they said it.',
    path: '/',
    body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'WebSite', name: SITE.name, url: SITE.url,
      potentialAction: { '@type': 'SearchAction', target: `${SITE.url}/answers?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    }, {
      '@context': 'https://schema.org', '@type': 'Organization', name: SITE.name, url: SITE.url, logo: `${SITE.url}/logo.png`,
      parentOrganization: { '@type': 'Organization', name: 'Main Street Creative', url: 'https://mainstreetmakes.com' },
    }],
  });
}

function topicsPage({ counts, popular }) {
  const body = `
<section class="page-head"><div class="wrap">
  <h1>Browse by topic</h1>
  <p class="lead">Every answer here came out of a conversation with someone who works in the field.</p>
</div></section>
<section class="section"><div class="wrap">${categoryGrid(counts)}</div></section>
${popular.length ? `<section class="section section-alt"><div class="wrap"><div class="section-head"><h2>Popular questions right now</h2></div><div class="grid-3">${popular.map(articleCard).join('')}</div></div></section>` : ''}`;
  return layout({ title: 'Topics', description: 'Browse podcast answers by topic: business, money, home, health, law, real estate and more.', path: '/topics', body });
}

function answersIndex({ articles, category, query, page, hasMore }) {
  const cat = category ? CATEGORIES[category] : null;
  const title = cat ? `${cat.name} questions, answered` : (query ? `Answers for "${query}"` : 'Questions people asked');
  const body = `
<section class="page-head"><div class="wrap">
  <h1>${esc(title)}</h1>
  <p class="lead">${cat ? esc(cat.blurb) : 'Straight answers, written out, with the timestamp of the moment an expert said it.'}</p>
  <form class="search" action="/answers" method="get"><input type="search" name="q" value="${esc(query || '')}" placeholder="Ask anything, like 'how long does a new roof last'" aria-label="Search answers"><button class="btn btn-primary" type="submit">Search</button></form>
  <div class="chips">${Object.entries(CATEGORIES).map(([k, v]) => `<a class="chip ${k === category ? 'chip-on' : ''}" href="/topics/${k}">${esc(v.name)}</a>`).join('')}</div>
</div></section>
<section class="section"><div class="wrap">
  ${articles.length ? `<div class="grid-3">${articles.map(articleCard).join('')}</div>` : '<p class="muted">Nothing on that yet. Try a broader search, or pick a topic above.</p>'}
  <div class="pager">${page > 1 ? `<a class="btn btn-ghost" href="?${query ? 'q=' + encodeURIComponent(query) + '&' : ''}page=${page - 1}">← Newer</a>` : ''}${hasMore ? `<a class="btn btn-ghost" href="?${query ? 'q=' + encodeURIComponent(query) + '&' : ''}page=${page + 1}">Older →</a>` : ''}</div>
</div></section>`;
  return layout({ title, description: cat ? `${cat.blurb} Answers taken from real podcast episodes, with timestamps.` : 'Real questions answered by podcast hosts and guests, written out and timestamped.', path: category ? `/topics/${category}` : '/answers', body, noindex: !!query,
    canonical: `${SITE.url}${category ? `/topics/${category}` : '/answers'}${page > 1 ? `?page=${page}` : ''}` });
}

function articlePage({ a, p, e, related, moreFromShow }) {
  const b = a.body;
  const hasAudio = !!(e && e.audio_url);
  const quoteBlock = (s) => {
    if (!s.quote || !s.quote.text) return '';
    const secs = tsToSeconds(s.quote.timestamp);
    const jump = secs != null && hasAudio
      ? `<button class="ts-btn" data-t="${secs}" type="button">▶ Play from ${esc(s.quote.timestamp)}</button>`
      : (s.quote.timestamp ? `<span class="ts-flat">at ${esc(s.quote.timestamp)}</span>` : '');
    return `<blockquote class="quote">
      <p>"${esc(s.quote.text)}"</p>
      <footer><strong>${esc(s.quote.speaker || p.author || p.title)}</strong>${e ? ` on <a href="/podcasts/${esc(p.slug)}/episodes/${esc(e.slug)}">${esc(e.title)}</a>` : ''} ${jump}</footer>
    </blockquote>`;
  };
  const sections = (b.sections || []).map((s) => `
    <h2>${esc(s.heading)}</h2>
    ${md(s.body)}
    ${quoteBlock(s)}`).join('');
  const faq = (b.faq || []).filter((f) => f.q && f.a);
  const body = `
<article class="article">
  <div class="wrap article-grid">
    <div class="article-main">
      <p class="crumbs"><a href="/answers">Answers</a> › <a href="/topics/${esc(p.category)}">${esc((CATEGORIES[p.category] || {}).name || p.category)}</a></p>
      <h1>${esc(a.question)}</h1>
      <p class="byline">Answered by <strong>${esc(p.author || p.title)}</strong> on <a href="/podcasts/${esc(p.slug)}">${esc(p.title)}</a> · ${fmtDate(a.published_at)}</p>
      <div class="answer-lead"><p>${esc(b.intro)}</p></div>
      ${e ? `<div class="episode-box" id="player">
        <img loading="lazy" decoding="async" src="${esc(p.image_url || '/placeholder.svg')}" alt="" width="64" height="64" onerror="this.src='/placeholder.svg'">
        <div class="episode-box-main">
          <p class="small muted">Hear it yourself</p>
          <p><strong><a href="/podcasts/${esc(p.slug)}/episodes/${esc(e.slug)}">${esc(e.title)}</a></strong></p>
          <p class="small muted">${esc(p.title)} · ${fmtDate(e.published_at)}${e.duration_sec ? ` · ${fmtDuration(e.duration_sec)}` : ''}</p>
          ${e.audio_url ? `<audio id="ep-audio" controls preload="none" src="${esc(e.audio_url)}"></audio><p class="small muted ts-hint">Tap any timestamp below to jump straight to that moment.</p>` : ''}
          ${e.transcript && p.tier !== 'listed' ? `<p class="small"><a class="link" href="/transcripts/${e.id}?from=${esc(a.slug)}" rel="nofollow">Read the full transcript of this episode</a></p>` : ''}
        </div>
      </div>` : ''}
      ${sections}
      ${(b.keyTakeaways || []).length ? `<div class="takeaways"><h2>The short version</h2><ul>${b.keyTakeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      ${faq.length ? `<h2>People also ask</h2>${faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}` : ''}
      ${b.sourceNote ? `<p class="source muted small">${esc(b.sourceNote)}</p>` : ''}
    </div>
    <aside class="article-side">
      <div class="side-card">
        <img loading="lazy" decoding="async" src="${esc(p.image_url || '/placeholder.svg')}" alt="${esc(p.title)} artwork" width="110" height="110" onerror="this.src='/placeholder.svg'">
        <h3><a href="/podcasts/${esc(p.slug)}">${esc(p.title)}</a></h3>
        <p class="muted small">${esc(p.author || '')}</p>
        <p class="small">${esc((p.description || '').slice(0, 200))}${(p.description || '').length > 200 ? '…' : ''}</p>
        ${listenButtons(p, a.id, { label: 'Follow the show' })}
      </div>
      ${moreFromShow.length ? `<div class="side-card"><h4>More from this show</h4>${moreFromShow.map((r) => `<a class="side-link" href="/answers/${esc(r.slug)}">${esc(r.question)}</a>`).join('')}</div>` : ''}
    </aside>
  </div>
</article>
${related.length ? `<section class="section section-alt"><div class="wrap"><div class="section-head"><h2>Related questions</h2></div><div class="grid-3">${related.map(articleCard).join('')}</div></div></section>` : ''}`;
  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'Article', headline: a.question, description: a.meta_description,
    datePublished: a.published_at, dateModified: a.updated_at, url: `${SITE.url}/answers/${a.slug}`,
    author: { '@type': 'Person', name: p.author || p.title }, publisher: { '@type': 'Organization', name: SITE.name, logo: { '@type': 'ImageObject', url: `${SITE.url}/logo.png` } },
    image: `${SITE.url}/img/answer/${a.slug}.png`,
    isBasedOn: e ? { '@type': 'PodcastEpisode', name: e.title, url: e.episode_url || `${SITE.url}/podcasts/${p.slug}/episodes/${e.slug}`, datePublished: e.published_at, partOfSeries: { '@type': 'PodcastSeries', name: p.title, url: p.website || `${SITE.url}/podcasts/${p.slug}` } } : undefined,
  }];
  if (faq.length) jsonld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  jsonld.push(crumbs([
    { name: 'Answers', path: '/answers' },
    { name: (CATEGORIES[p.category] || {}).name || p.category, path: `/topics/${p.category}` },
    { name: a.question, path: `/answers/${a.slug}` },
  ]));
  return layout({ title: a.question, description: a.meta_description || b.intro, path: `/answers/${a.slug}`, body, jsonld, ogImage: `${SITE.url}/img/answer/${a.slug}.png` });
}

function podcastsIndex({ podcasts, counts, category }) {
  const cat = category ? CATEGORIES[category] : null;
  const body = `
<section class="page-head"><div class="wrap">
  <h1>${cat ? `${esc(cat.name)} shows` : 'Shows on the network'}</h1>
  <p class="lead">${cat ? esc(cat.blurb) : 'The podcasts our answers come from. Every episode indexed, the useful parts written up.'}</p>
  <div class="chips">${Object.entries(CATEGORIES).map(([k, v]) => `<a class="chip ${k === category ? 'chip-on' : ''}" href="/podcasts?category=${k}">${esc(v.name)}${counts[k] ? ` (${counts[k]})` : ''}</a>`).join('')}</div>
</div></section>
<section class="section"><div class="wrap"><div class="grid-4">${podcasts.map((p) => podcastCard(p)).join('')}</div></div></section>`;
  return layout({ title: cat ? `${cat.name} podcasts` : 'All shows', description: 'Every podcast whose episodes are indexed and answered on PodAnswer.', path: category ? `/podcasts?category=${category}` : '/podcasts', body, noindex: !!category });
}

function podcastPage({ p, episodes, articles, stats }) {
  const body = `
<section class="pod-head"><div class="wrap pod-head-in">
  <img loading="lazy" decoding="async" src="${esc(p.image_url || '/placeholder.svg')}" alt="${esc(p.title)} artwork" width="190" height="190" onerror="this.src='/placeholder.svg'">
  <div>
    <p class="crumbs"><a href="/podcasts">Podcasts</a> › <a href="/topics/${esc(p.category)}">${esc((CATEGORIES[p.category] || {}).name || p.category)}</a></p>
    <h1>${esc(p.title)}</h1>
    ${p.author ? `<p class="byline">Hosted by ${esc(p.author)}</p>` : ''}
    <p>${esc(p.description || '')}</p>
    ${listenButtons(p, null, { label: 'Listen and follow' })}
    <p class="muted small">${stats.articles} question${stats.articles === 1 ? '' : 's'} answered · ${stats.episodes} episode${stats.episodes === 1 ? '' : 's'} indexed</p>
  </div>
</div></section>
<section class="section"><div class="wrap">
  <div class="section-head"><h2>What this show answers</h2></div>
  ${articles.length ? `<div class="grid-3">${articles.map(articleCard).join('')}</div>` : '<p class="muted">Answers from this show are being written now.</p>'}
</div></section>
<section class="section section-alt"><div class="wrap">
  <div class="section-head"><h2>Recent episodes</h2></div>
  <div class="ep-list">${episodes.map((e) => `<a class="ep" href="/podcasts/${esc(p.slug)}/episodes/${esc(e.slug)}"><span class="muted small">${fmtDate(e.published_at)}${e.duration_sec ? ` · ${fmtDuration(e.duration_sec)}` : ''}</span><strong>${esc(e.title)}</strong><span class="muted small">${esc((e.summary || '').slice(0, 170))}</span></a>`).join('')}</div>
</div></section>
${p.tier === 'listed' ? `<section class="section"><div class="wrap claim"><h2>Is this your show?</h2><p>It's listed free. Join the network and we'll turn your episodes into answers that people find on Google.</p><a class="btn btn-primary" href="/signup?podcast=${encodeURIComponent(p.title)}">Claim ${esc(p.title)}</a></div></section>` : ''}`;
  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'PodcastSeries', name: p.title, description: p.description, url: p.website || `${SITE.url}/podcasts/${p.slug}`, image: p.image_url || undefined,
    author: p.author ? { '@type': 'Person', name: p.author } : undefined, webFeed: p.feed_url || undefined,
  }];
  jsonld.push(crumbs([{ name: 'Podcasts', path: '/podcasts' }, { name: (CATEGORIES[p.category] || {}).name || p.category, path: `/topics/${p.category}` }, { name: p.title, path: `/podcasts/${p.slug}` }]));
  return layout({ title: `${p.title}: episodes and answers`, description: (p.description || '').slice(0, 155), path: `/podcasts/${p.slug}`, body, jsonld, ogImage: p.image_url });
}

function episodePage({ p, e, articles }) {
  const body = `
<section class="page-head"><div class="wrap">
  <p class="crumbs"><a href="/podcasts">Podcasts</a> › <a href="/podcasts/${esc(p.slug)}">${esc(p.title)}</a></p>
  <h1>${esc(e.title)}</h1>
  <p class="byline">${esc(p.title)}${p.author ? ` · ${esc(p.author)}` : ''} · ${fmtDate(e.published_at)}${e.duration_sec ? ` · ${fmtDuration(e.duration_sec)}` : ''}</p>
  ${e.audio_url ? `<audio id="ep-audio" controls preload="none" src="${esc(e.audio_url)}"></audio>` : ''}
</div></section>
<section class="section"><div class="wrap article-grid">
  <div class="article-main">
    <h2>What's in this episode</h2>
    <p>${esc(e.summary || '')}</p>
    ${articles.length ? `<h2>Questions it answers</h2><div class="grid-2">${articles.map(articleCard).join('')}</div>` : ''}
    ${e.transcript ? `<h2>Full transcript</h2><div class="transcript">${md(e.transcript)}</div>` : ''}
    ${e.episode_url ? `<p><a class="link" rel="nofollow" href="${esc(e.episode_url)}">Episode page on the show's own site →</a></p>` : ''}
  </div>
  <aside class="article-side"><div class="side-card">
    <img loading="lazy" decoding="async" src="${esc(p.image_url || '/placeholder.svg')}" alt="" width="110" height="110" onerror="this.src='/placeholder.svg'">
    <h3><a href="/podcasts/${esc(p.slug)}">${esc(p.title)}</a></h3>
    <p class="small">${esc((p.description || '').slice(0, 190))}</p>
    ${listenButtons(p, null, { label: 'Listen and follow' })}
  </div></aside>
</div></section>`;
  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'PodcastEpisode', name: e.title, description: e.summary, datePublished: e.published_at, url: `${SITE.url}/podcasts/${p.slug}/episodes/${e.slug}`,
    timeRequired: e.duration_sec ? `PT${Math.round(e.duration_sec / 60)}M` : undefined,
    associatedMedia: e.audio_url ? { '@type': 'MediaObject', contentUrl: e.audio_url } : undefined,
    partOfSeries: { '@type': 'PodcastSeries', name: p.title, url: p.website || `${SITE.url}/podcasts/${p.slug}` },
  }];
  jsonld.push(crumbs([{ name: 'Podcasts', path: '/podcasts' }, { name: p.title, path: `/podcasts/${p.slug}` }, { name: e.title, path: `/podcasts/${p.slug}/episodes/${e.slug}` }]));
  // An episode page with no written answer and no transcript is a thin page.
  // Thin pages drag a whole site down, so they are crawlable but not indexed.
  const thin = !articles.length && !e.transcript;
  return layout({ title: `${e.title} (${p.title})`, description: (e.summary || '').slice(0, 155), path: `/podcasts/${p.slug}/episodes/${e.slug}`, body, jsonld, ogImage: p.image_url, noindex: thin });
}


/* ---------- topic hubs: one silo per subject ---------- */

function topicHub({ topic, cat, articles, podcasts, siblings, page, hasMore, total }) {
  const body = `
<section class="page-head"><div class="wrap">
  <p class="crumbs"><a href="/topics">Topics</a></p>
  <h1>${esc(cat.h1)}</h1>
  <p class="lead">${esc(cat.intro)}</p>
  <form class="search" action="/answers" method="get"><input type="search" name="q" placeholder="Search ${esc(cat.name.toLowerCase())} questions" aria-label="Search"><button class="btn btn-primary" type="submit">Search</button></form>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head"><h2>${total} ${esc(cat.name.toLowerCase())} question${total === 1 ? '' : 's'} answered</h2></div>
  ${articles.length ? `<div class="grid-3">${articles.map(articleCard).join('')}</div>` : '<p class="muted">Answers in this topic are being written now.</p>'}
  <div class="pager">${page > 1 ? `<a class="btn btn-ghost" href="?page=${page - 1}">← Newer</a>` : ''}${hasMore ? `<a class="btn btn-ghost" href="?page=${page + 1}">More →</a>` : ''}</div>
</div></section>

${podcasts.length ? `<section class="section section-alt"><div class="wrap">
  <div class="section-head"><h2>Shows these answers come from</h2></div>
  <div class="grid-4">${podcasts.map((p) => podcastCard(p, { showCategory: false })).join('')}</div>
</div></section>` : ''}

<section class="section"><div class="wrap">
  <div class="section-head"><h2>Other topics</h2></div>
  <div class="chips">${siblings.map(([k, v]) => `<a class="chip" href="/topics/${k}">${esc(v.name)}</a>`).join('')}</div>
</div></section>`;
  return layout({
    title: cat.h1,
    description: `${cat.blurb} ${cat.intro}`.slice(0, 155),
    path: `/topics/${topic}`, body, noindex: page > 1,
    jsonld: [crumbs([{ name: 'Topics', path: '/topics' }, { name: cat.name, path: `/topics/${topic}` }]), {
      '@context': 'https://schema.org', '@type': 'CollectionPage', name: cat.h1, description: cat.intro,
      url: `${SITE.url}/topics/${topic}`,
      mainEntity: { '@type': 'ItemList', itemListElement: articles.slice(0, 20).map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE.url}/answers/${a.slug}`, name: a.question })) },
    }],
  });
}

/* ---------- accounts ---------- */

function authPage({ mode, error, email, next }) {
  const isSignup = mode === 'signup';
  const body = `
<section class="page-head"><div class="wrap">
  <p class="eyebrow">For podcasters</p>
  <h1>${isSignup ? 'Create your account' : 'Sign in'}</h1>
  <p class="lead">${isSignup ? 'One account holds your show, your plan and your results.' : 'Welcome back.'}</p>
</div></section>
<section class="section"><div class="wrap form-wrap">
  ${error ? `<div class="notice notice-err">${esc(error)}</div>` : ''}
  <form method="post" action="/${isSignup ? 'signup' : 'login'}" class="form">
    ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
    ${isSignup ? '<label>Your name<input name="name" required maxlength="120" autocomplete="name"></label>' : ''}
    <label>Email<input name="email" type="email" required maxlength="200" value="${esc(email || '')}" autocomplete="email"></label>
    <label>Password<input name="password" type="password" required minlength="8" maxlength="200" autocomplete="${isSignup ? 'new-password' : 'current-password'}">${isSignup ? '<span class="muted small">At least 8 characters.</span>' : ''}</label>
    ${isSignup ? `<label>Podcast name<input name="podcast_name" maxlength="200"></label>
    <label>RSS feed URL <span class="muted small">(you can add this later)</span><input name="feed_url" type="url" maxlength="500" placeholder="https://feeds.example.com/yourshow"></label>` : ''}
    ${isSignup ? `<label class="check"><input type="checkbox" name="agree_terms" value="1" required> I agree to the <a href="/terms" target="_blank">Terms of Service</a> and the <a href="/refunds" target="_blank">Refund Policy</a>.</label>` : ''}
    <button class="btn btn-primary btn-lg" type="submit">${isSignup ? 'Create account' : 'Sign in'}</button>
  </form>
  <p class="muted small">${isSignup ? 'Already have an account? <a href="/login">Sign in</a>.' : 'New here? <a href="/signup">Create an account</a>.'}</p>
</div></section>`;
  return layout({ title: isSignup ? 'Create your account' : 'Sign in', description: 'Manage your podcast, plan and results on PodAnswer.', path: `/${isSignup ? 'signup' : 'login'}`, body, noindex: true });
}

function accountPage({ user, podcast, subscription, articles, jobs, totals, plans, notice, stripeReady }) {
  const active = subscription && subscription.status === 'active';
  const body = `
<section class="page-head"><div class="wrap">
  <p class="eyebrow">Your account</p>
  <h1>${esc(podcast ? podcast.title : user.name || user.email)}</h1>
  <p class="lead">${active ? `${esc(subscription.plan === 'network' ? 'Network' : 'Growth')} plan, ${subscription.quota} answers a month.` : 'Add your show and choose a plan to start publishing answers.'}</p>
</div></section>
<section class="section"><div class="wrap">
  ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}

  <h2>Your show</h2>
  <form method="post" action="/account/podcast" class="form form-inline">
    <label>Podcast name<input name="title" required maxlength="200" value="${esc(podcast ? podcast.title : '')}"></label>
    <label>RSS feed URL<input name="feed_url" type="url" maxlength="500" value="${esc(podcast ? podcast.feed_url : '')}" placeholder="https://feeds.example.com/yourshow"></label>
    <label>YouTube channel <span class="muted small">(optional, lets us pull transcripts)</span><input name="youtube_url" type="url" maxlength="300" value="${esc(podcast && podcast.youtube_url ? podcast.youtube_url : '')}" placeholder="https://www.youtube.com/@yourshow"></label>
    <label>Topic
      <select name="category">
        ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${podcast && podcast.category === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
      </select>
    </label>
    <button class="btn btn-ghost" type="submit">Save</button>
  </form>
  ${podcast && podcast.slug && podcast.tier !== 'listed' ? `
    <p style="margin:16px 0 8px"><a class="btn btn-primary" href="/dashboard/${esc(podcast.dashboard_token)}">Choose this month's episodes</a></p>
    <p class="small"><a class="link" href="/podcasts/${esc(podcast.slug)}">View your public show page →</a> · <a class="link" href="/dashboard/${esc(podcast.dashboard_token)}">Full results dashboard →</a></p>` : ''}

  <h2>Plan</h2>
  ${active ? `
    <div class="plan-state">
      <p><strong>${esc(subscription.plan === 'network' ? 'Network' : 'Growth')}</strong> · ${subscription.quota} answers a month · renews ${fmtDate(subscription.current_period_end)}</p>
      <form method="post" action="/account/portal"><button class="btn btn-ghost" type="submit">Manage billing, invoices or cancel</button></form>
    </div>` : `
    ${!stripeReady ? '<div class="notice notice-err">Checkout is not switched on yet.</div>' : ''}
    <div class="plans plans-2">
      ${Object.entries(plans).map(([key, cfg]) => `
      <div class="plan ${key === 'growth' ? 'plan-featured' : ''}">
        ${key === 'growth' ? '<span class="chip chip-solid">Most popular</span>' : ''}
        <h3>${esc(cfg.name)}</h3>
        <p class="price">${esc(cfg.amount.split('/')[0])}<span>/month</span></p>
        <p class="muted">${cfg.quota} answers researched, written and published each month.</p>
        <form method="post" action="/account/checkout"><input type="hidden" name="plan" value="${key}">
          <button class="btn ${key === 'growth' ? 'btn-primary' : 'btn-ghost'}" type="submit" ${!stripeReady || !podcast || !podcast.feed_url ? 'disabled' : ''}>Start ${esc(cfg.name)}</button>
          <p class="muted small">By starting a plan you agree to the <a href="/terms">Terms of Service</a> and <a href="/refunds">Refund Policy</a>.</p>
        </form>
        ${!podcast || !podcast.feed_url ? '<p class="muted small">Add your podcast name and feed above first.</p>' : ''}
      </div>`).join('')}
    </div>`}

  ${active ? `
  <h2>Results, last 30 days</h2>
  <div class="stat-grid stat-grid-dash">
    <div class="stat"><strong>${Number(totals.views || 0).toLocaleString()}</strong><span>read an answer</span></div>
    <div class="stat"><strong>${Number(totals.clicks || 0).toLocaleString()}</strong><span>clicked to listen</span></div>
    <div class="stat"><strong>${articles.length}</strong><span>answers live</span></div>
    <div class="stat"><strong>${jobs.filter((j) => j.status === 'done').length}</strong><span>runs completed</span></div>
  </div>` : ''}

  ${articles.length ? `<h2>Your answers</h2>
  <table class="table"><thead><tr><th>Question</th><th>Published</th></tr></thead><tbody>
  ${articles.map((a) => `<tr><td><a href="/answers/${esc(a.slug)}">${esc(a.question)}</a></td><td>${fmtDate(a.published_at)}</td></tr>`).join('')}
  </tbody></table>` : ''}

  ${jobs.length ? `<h2>Production runs</h2>
  <table class="table"><thead><tr><th>Started</th><th>Type</th><th>Status</th><th>Answers</th><th>Detail</th></tr></thead><tbody>
  ${jobs.map((j) => `<tr><td>${fmtDate(j.created_at)}</td><td>${esc(j.kind)}</td><td>${esc(j.status)}</td><td>${j.articles_written}</td><td class="small muted">${esc(j.detail || '')}</td></tr>`).join('')}
  </tbody></table>` : ''}

  <p class="muted small"><a href="/logout">Sign out</a></p>
</div></section>`;
  return layout({ title: 'Your account', description: 'Manage your podcast, plan and results.', path: '/account', body, noindex: true });
}

/* ---------- podcaster side ---------- */

function forPodcasters() {
  const body = `
<section class="hero hero-sm">
  <div class="wrap hero-in">
    <p class="eyebrow">For podcasters</p>
    <h1>Get found by people who <em>aren't looking for a podcast.</em></h1>
    <p class="lead">Most of your future listeners will never browse a podcast app for a show like yours. They'll type a question into Google. If your episode answered that question, we make sure the page they land on is yours.</p>
    <div class="hero-cta"><a class="btn btn-primary btn-lg" href="/signup">Create your account</a><a class="btn btn-ghost btn-lg" href="/pricing">See plans</a></div>
  </div>
</section>

<section class="section"><div class="wrap prose">
  <h2>What we do with your feed</h2>
  <div class="steps">
    <div class="step"><span class="num">1</span><div><h3>Your episodes become text</h3><p>You hand us your RSS feed and nothing else. Every episode you've published, and every one you publish from here on, gets transcribed automatically. Until that happens, everything said on your show is invisible to Google.</p></div></div>
    <div class="step"><span class="num">2</span><div><h3>You pick the episodes, we pick the question</h3><p>Your dashboard lists everything you have published. Tick the ones you want turned into articles, up to your month's allowance. For each one we read the transcript, pull the searches people are actually typing in your subject, and target the question with the most traffic behind it that your episode genuinely answers. Sometimes that is the episode's headline subject. Often it is something smaller you covered halfway through that far more people are looking for, and we take that instead. You see which phrase we chose.</p></div></div>
    <div class="step"><span class="num">3</span><div><h3>We write the answers and publish them</h3><p>Each question becomes its own article on PodAnswer, built to rank: the question as the headline, the answer up front, your words quoted, and the episode embedded. You can watch each one move from the queue to research to writing in your dashboard, and you get an email with the links when they are live. Any article can be rewritten for $15, which keeps its web address so it holds the ranking it has built, or taken off the site for nothing at all.</p></div></div>
    <div class="step"><span class="num">4</span><div><h3>Readers land on it and press play</h3><p>Every quote carries the timestamp of where you said it. A reader can take the written answer and go, or tap the timestamp and hear you say it at the exact minute. Either way your name and your show are on the page, with follow links to every app.</p></div></div>
    <div class="step"><span class="num">5</span><div><h3>You watch it work</h3><p>A private dashboard shows which questions you're ranking for, how many people read each answer, and how many clicked through to listen. A plain-English summary lands in your inbox every week, with the impressions, clicks and search positions taken straight from Google Search Console.</p></div></div>
  </div>

  <h2>Two ways onto the network</h2>
  <p>Either we add you because you record with us, or you buy a package of articles. Same treatment either way: transcription, keyword research, written answers, timestamps, dashboard.</p>

  <h2>What we can and can't measure</h2>
  <p>We can show you exactly how many people read each answer and how many clicked your Apple, Spotify or website links. Nobody can see inside Apple or Spotify to tell you which of those clicks became a subscriber. If you add a free download-tracking prefix to your feed, and we'll walk you through it, you can watch your downloads move as articles start ranking.</p>

  <h2>How long it takes</h2>
  <p>New pages usually start showing up in Google within a few weeks and build over three to six months as your section of the site fills out. This is the opposite of a social post: an article written this month is still bringing listeners next year, and every new one makes the earlier ones rank better.</p>

  <div class="hero-cta"><a class="btn btn-primary btn-lg" href="/signup">Create your account</a><a class="btn btn-ghost btn-lg" href="/pricing">See plans and pricing</a></div>
</div></section>`;
  return layout({ title: 'For podcasters', description: 'PodAnswer transcribes your episodes, researches the questions people search, writes the answers and publishes them with timestamps back to your show.', path: '/for-podcasters', body });
}

function pricing() {
  const body = `
<section class="page-head"><div class="wrap">
  <p class="eyebrow">For podcasters</p>
  <h1>Packages of answers</h1>
  <p class="lead">Every show can be listed free. Paid packages cover transcription, the keyword research that decides what gets written, the articles themselves, and the reporting. You choose which episodes get turned into articles.</p>
</div></section>
<section class="section"><div class="wrap">
  <div class="plans">
    <div class="plan">
      <h3>Listed</h3>
      <p class="price">Free</p>
      <p class="muted">Your show on the network.</p>
      <ul>
        <li>Show page with your artwork and description</li>
        <li>Your recent episodes pulled in when you join</li>
        <li>Follow links to Apple, Spotify and your site</li>
        <li>Upgrade whenever you want answers written</li>
      </ul>
      <a class="btn btn-ghost" href="/signup">List my show</a>
    </div>
    <div class="plan plan-featured">
      <span class="chip chip-solid">Most popular</span>
      <h3>Growth</h3>
      <p class="price">$149<span>/month</span></p>
      <p class="muted">Four answers a month, researched and published.</p>
      <ul>
        <li>Everything in Listed</li>
        <li>Every episode transcribed</li>
        <li>Keyword and search research each month</li>
        <li>4 answer articles written and published</li>
        <li>You pick the episodes from your dashboard</li>
        <li>Timestamped quotes linking back to your episodes</li>
        <li>Click tracking on every listen link</li>
        <li>Dashboard plus a weekly report from Search Console</li>
      </ul>
      <a class="btn btn-primary" href="/signup?next=%2Faccount">Start Growth</a>
    </div>
    <div class="plan">
      <h3>Network</h3>
      <p class="price">$349<span>/month</span></p>
      <p class="muted">For shows that want to own their subject.</p>
      <ul>
        <li>Everything in Growth</li>
        <li>12 answer articles each month</li>
        <li>You pick the episodes from your dashboard</li>
        <li>Back catalog mined for evergreen questions</li>
        <li>Social clip scripts from your best moments</li>
        <li>Priority placement across the network</li>
        <li>Quarterly strategy call</li>
      </ul>
      <a class="btn btn-ghost" href="/signup?next=%2Faccount">Start Network</a>
    </div>
  </div>
  <div class="studio-note">
    <h3>Recording with Main Street Creative?</h3>
    <p>Production clients get the Growth package included. <a class="link" href="/for-studios">Details for studios and agencies →</a></p>
  </div>
  <div class="prose">
    <h2>Common questions</h2>
    <details class="faq"><summary>Do I need to record anything new?</summary><p>No. It all comes from episodes you've already published. Your feed is the only thing we need from you.</p></details>
    <details class="faq"><summary>Who decides what gets written?</summary><p>You choose the episodes. Tick up to your month's allowance in your dashboard and we take it from there. For each one we read the transcript, pull the real searches people type in your subject, and target the question with the most traffic behind it that your episode genuinely answers. Sometimes that's the episode's headline subject and sometimes it's a smaller thing you covered halfway through that far more people search for. You see which phrase we chose.</p></details>
    <details class="faq"><summary>What if I don't like an article?</summary><p>There's a rewrite button on every article in your dashboard. It's $15 and it keeps the same web address, so the page holds any ranking it has already built. If you'd rather it came off the site altogether there's a take-down button next to it, that one is free, it works instantly, and you can put the article back whenever you want.</p></details>
    <details class="faq"><summary>How do I know it's working?</summary><p>A report every week with impressions, clicks, average position and the searches you showed up for, straight from Google Search Console, plus how many people tapped through to Apple, Spotify or your own site. Your dashboard has the same numbers any time you want them.</p></details>
    <details class="faq"><summary>Where do the articles live?</summary><p>On podanswer.com, in your show's section. That's deliberate: the network's authority is shared, so your answers rank faster than they would on a brand new site of your own. You're free to republish them on your own site too.</p></details>
    <details class="faq"><summary>How long until I see listeners?</summary><p>Articles typically start ranking within a few weeks and build over three to six months. It compounds, so results keep growing as your section fills out.</p></details>
    <details class="faq"><summary>Can I cancel?</summary><p>Any time. Articles already published stay up and keep working.</p></details>
  </div>
</div></section>`;
  return layout({ title: 'Pricing for podcasters', description: 'Free listing, or monthly packages that transcribe your episodes, research the questions and publish answers that rank. You pick the episodes.', path: '/pricing', body });
}

function forStudios() {
  const body = `
<section class="page-head"><div class="wrap">
  <p class="eyebrow">For podcasters</p>
  <h1>For studios and agencies</h1>
  <p class="lead">If you produce podcasts for clients, the hardest question they ask is how to get more listeners. This is the answer you can put in the proposal.</p>
</div></section>
<section class="section"><div class="wrap prose">
  <h2>What your clients get</h2>
  <p>Every show you produce gets its own section of the network, its episodes transcribed, and a steady run of articles that rank for questions its audience is already searching. Each client sees their own rankings, readers and clicks in a dashboard with their name on it.</p>
  <h2>What you get</h2>
  <ul>
    <li>A promotion line item you can measure and bill monthly</li>
    <li>Monthly reports you can forward to the client as they are</li>
    <li>Network pricing for five or more shows</li>
    <li>Co-branded dashboards on request</li>
  </ul>
  <p>PodAnswer is run by Main Street Creative, an advertising agency in Doylestown, Pennsylvania, and it started as the promotion engine for our own podcast production clients. It works the same for yours.</p>
  <div class="hero-cta"><a class="btn btn-primary btn-lg" href="mailto:${esc(SITE.email)}?subject=PodAnswer%20for%20our%20studio">Talk to us</a></div>
</div></section>`;
  return layout({ title: 'For studios and agencies', description: 'Offer PodAnswer to your podcast production clients: transcription, keyword research, published answers and weekly reports.', path: '/for-studios', body });
}

function about() {
  const body = `
<section class="page-head"><div class="wrap"><h1>About PodAnswer</h1><p class="lead">The best answer to a lot of questions was given out loud, by someone who does the work, on a show almost nobody found.</p></div></section>
<section class="section"><div class="wrap prose">
  <p>A contractor explains exactly how to price a patio. A lawyer walks through what actually happens in a small claims hearing. A physical therapist explains why your shoulder hurts. All of it recorded, all of it free, and almost none of it findable, because search engines can't hear.</p>
  <p>PodAnswer fixes that. We transcribe episodes, find the moments that answer real questions, write them up so you can read the answer in half a minute, and timestamp the audio so you can hear the person say it if you'd rather. The show gets credit and a link on every page.</p>
  <p>It's built by <a href="https://mainstreetmakes.com">Main Street Creative</a>, a creative advertising and digital marketing agency in Doylestown, Pennsylvania. We produce podcasts for clients, and every one of them asked the same thing after launch: how do we get listeners? This is our answer to that, opened up to any show that wants in.</p>
  <p>Shows featured here keep full ownership of their audio, artwork and words. Free listings show your show description and episode titles with credit and links back. To update or remove a show, email <a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a> and we'll handle it quickly.</p>
  <p>Main Street Creative · 152 N Main St, Doylestown, PA 18901 · (215) 206-3657</p>
</div></section>`;
  return layout({ title: 'About', description: 'PodAnswer turns podcast episodes into readable, timestamped answers so people can find expert advice through search.', path: '/about', body });
}

function joinPage({ plan, podcast, sent, error }) {
  const body = `
<section class="page-head"><div class="wrap"><p class="eyebrow">For podcasters</p><h1>Add your show</h1><p class="lead">Free listings go live after a quick review. Choose a package and we'll be in touch within one business day to start the research.</p></div></section>
<section class="section"><div class="wrap form-wrap">
  ${sent ? `<div class="notice">Got it. We'll be in touch shortly at the email you gave us.</div>` : ''}
  ${error ? `<div class="notice notice-err">${esc(error)}</div>` : ''}
  <form method="post" action="/join" class="form">
    <label>Your name<input name="name" required maxlength="120"></label>
    <label>Email<input name="email" type="email" required maxlength="200"></label>
    <label>Podcast name<input name="podcast_name" required maxlength="200" value="${esc(podcast || '')}"></label>
    <label>RSS feed URL <span class="muted small">(in your hosting dashboard)</span><input name="feed_url" type="url" maxlength="500" placeholder="https://feeds.example.com/yourshow"></label>
    <label>Package
      <select name="plan">
        <option value="listed" ${plan === 'listed' || !plan ? 'selected' : ''}>Listed (free)</option>
        <option value="growth" ${plan === 'growth' ? 'selected' : ''}>Growth ($149/mo)</option>
        <option value="network" ${plan === 'network' ? 'selected' : ''}>Network ($349/mo)</option>
        <option value="studio" ${plan === 'studio' ? 'selected' : ''}>I'm a Main Street Creative client</option>
      </select>
    </label>
    <label>Anything we should know?<textarea name="message" rows="4" maxlength="2000"></textarea></label>
    <input type="text" name="website_url" class="hp" tabindex="-1" autocomplete="off">
    <button class="btn btn-primary btn-lg" type="submit">Send</button>
    <p class="muted small">No payment is taken here. We confirm everything with you first.</p>
  </form>
</div></section>`;
  return layout({ title: 'Add your podcast', description: 'List your podcast on PodAnswer free, or start a package that turns your episodes into answers that rank.', path: '/join', body, noindex: !!sent });
}

function blogIndex({ posts }) {
  const body = `
<section class="page-head"><div class="wrap"><p class="eyebrow">For podcasters</p><h1>Podcast promotion and growth</h1><p class="lead">What we have learned running the network, written for people who publish a show.</p></div></section>
<section class="section"><div class="wrap grid-2">${posts.map((b) => `<a class="card art-card" href="/blog/${esc(b.slug)}"><span class="muted small">${fmtDate(b.published_at)}</span><h3>${esc(b.title)}</h3><p class="muted">${esc(b.meta_description || '')}</p></a>`).join('')}</div></section>`;
  return layout({ title: 'Podcast promotion blog', description: 'How to promote a podcast, get more listeners, and make episodes rank on Google. Notes from the PodAnswer network.', path: '/blog', body });
}

function blogPost({ b, recent }) {
  const body = `
<article class="article"><div class="wrap article-grid">
  <div class="article-main">
    <p class="crumbs"><a href="/blog">Blog</a></p>
    <h1>${esc(b.title)}</h1>
    <p class="byline">PodAnswer · ${fmtDate(b.published_at)}</p>
    <div class="prose">${md(b.body_md)}</div>
  </div>
  <aside class="article-side">
    <div class="side-card side-promo"><h4>Want listeners from search?</h4><p class="small">We transcribe your episodes, research the questions people search, and publish the answers with links back to your show.</p><a class="btn btn-primary btn-sm" href="/for-podcasters">How it works</a></div>
    ${recent.length ? `<div class="side-card"><h4>More from the blog</h4>${recent.map((r) => `<a class="side-link" href="/blog/${esc(r.slug)}">${esc(r.title)}</a>`).join('')}</div>` : ''}
  </aside>
</div></article>`;
  return layout({
    title: b.title, description: b.meta_description, path: `/blog/${b.slug}`, body,
    ogImage: `${SITE.url}/img/blog/${b.slug}.png`,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'BlogPosting', headline: b.title, description: b.meta_description,
      datePublished: b.published_at, dateModified: b.updated_at, image: `${SITE.url}/img/blog/${b.slug}.png`,
      author: { '@type': 'Organization', name: 'PodAnswer' }, publisher: { '@type': 'Organization', name: SITE.name, logo: { '@type': 'ImageObject', url: `${SITE.url}/logo.png` } },
      mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE.url}/blog/${b.slug}` },
    }, crumbs([{ name: 'Blog', path: '/blog' }, { name: b.title, path: `/blog/${b.slug}` }])],
  });
}

function dashboard({ p, articles, clicksByPlatform, daily, totals, episodes = [], orders = [], suggestions = [], quota = 0, used = 0, periodEnd, rewritePrice = 15 }) {
  const maxDay = Math.max(1, ...daily.map((d) => Number(d.views)));
  const left = Math.max(0, quota - used);
  const live = articles.filter((a) => !a.removed_at);
  const working = orders.filter((o) => ['queued', 'researching', 'writing'].includes(o.status));
  const STATUS = {
    queued: ['In the queue', 'Usually live within a few hours, always within one business day. You get an email with the link.'],
    researching: ['Researching', 'Pulling the searches people actually type in your subject and matching them to the episode.'],
    writing: ['Writing', 'Drafting and publishing.'],
    failed: ['Stopped', 'Something blocked this one. The reason is below and you have not been charged for it.'],
    awaiting_payment: ['Waiting on payment', 'Finish the checkout and this starts straight away.'],
  };

  const picker = left > 0 && episodes.length ? `
  <form method="post" action="/dashboard/${esc(p.dashboard_token)}/request" class="ep-picker" id="pick">
    <p class="muted small">Tick up to ${left}. Under each episode you will see the questions people search for that the episode can answer, with a rough monthly search figure. Pick the one you want or leave it to us and we take the biggest. Articles are usually live within a few hours and always within one business day.</p>
    <div class="ep-list">
      ${episodes.map((e) => {
        const sg = suggestions.filter((x) => x.episode_id === e.id).slice(0, 4);
        return `<div class="ep-block">
        <label class="ep">
          <input type="checkbox" name="episode_id" value="${e.id}" data-cap="${left}">
          <span class="ep-t">${esc(e.title)}</span>
          <span class="ep-m">${fmtDate(e.published_at)}${e.has_text ? '' : ' · no transcript or notes yet'}${e.article_count ? ` · ${e.article_count} article${e.article_count === 1 ? '' : 's'} already` : ''}${sg.length ? '' : ' · search ideas arrive within the hour'}</span>
        </label>
        ${sg.length ? `<div class="ep-sugg">
          ${sg.map((x, i) => `<label class="sg"><input type="radio" name="suggestion_${e.id}" value="${x.id}" ${i === 0 ? 'checked' : ''}><span>${esc(x.question)}</span><em>${x.est_monthly_searches != null ? `about ${Number(x.est_monthly_searches).toLocaleString()} searches a month` : 'search volume unknown'}</em></label>`).join('')}
          <label class="sg"><input type="radio" name="suggestion_${e.id}" value="auto"><span>You choose for me</span><em>we take the biggest opportunity in the episode</em></label>
        </div>` : ''}
      </div>`;
      }).join('')}
    </div>
    <div class="ep-bar"><span id="pickcount" class="muted small">0 of ${left} selected</span><button class="btn btn-primary" id="pickgo" disabled>Write these</button></div>
  </form>` : left > 0 ? '<p class="muted">We are still reading your feed. Refresh in a few minutes and your episodes will be here.</p>'
    : `<p class="muted">You have used all ${quota} articles for this billing period.${periodEnd ? ` Your next ${quota} arrive on ${fmtDate(periodEnd)}.` : ''} Need more before then? <a class="link" href="mailto:${esc(SITE.email)}">Email us</a> and we will add them.</p>`;

  const body = `
<section class="page-head"><div class="wrap">
  <p class="eyebrow">Podcaster dashboard</p>
  <h1>${esc(p.title)}</h1>
  <p class="lead">Your articles, your numbers and your episode requests. This link is private to you, so bookmark it.</p>
</div></section>
<section class="section"><div class="wrap">
  <div class="stat-grid stat-grid-dash">
    <div class="stat"><strong>${Number(totals.views).toLocaleString()}</strong><span>people read an answer</span></div>
    <div class="stat"><strong>${Number(totals.clicks).toLocaleString()}</strong><span>clicked through to listen</span></div>
    <div class="stat"><strong>${totals.views ? ((totals.clicks / totals.views) * 100).toFixed(1) : '0.0'}%</strong><span>reader to listener rate</span></div>
    <div class="stat"><strong>${left} of ${quota}</strong><span>articles left this period</span></div>
  </div>

  <h2>Choose the episodes you want written</h2>
  ${picker}

  ${orders.length ? `<h2>In progress</h2>
  <table class="table"><thead><tr><th>Episode</th><th>Stage</th><th>Started</th><th></th></tr></thead><tbody>
    ${orders.slice(0, 12).map((o) => {
      const st = STATUS[o.status] || ['Published', ''];
      return `<tr>
        <td>${esc(o.episode_title || 'Episode removed')}${o.kind === 'rewrite' ? ' <span class="muted small">(rewrite)</span>' : ''}${o.target_query ? `<br><span class="muted small">Targeting: ${esc(o.target_query)}</span>` : ''}${o.status === 'failed' && o.detail ? `<br><span class="muted small">${esc(o.detail)}</span>` : ''}</td>
        <td><span class="pill pill-${esc(o.status)}">${esc(st[0])}</span>${st[1] ? `<br><span class="muted small">${esc(st[1])}</span>` : ''}</td>
        <td class="muted small">${fmtDate(o.created_at)}</td>
        <td>${o.article_slug ? `<a class="link" href="/answers/${esc(o.article_slug)}">Read it</a>` : ''}</td>
      </tr>`;
    }).join('')}
  </tbody></table>` : ''}

  <h2>Your articles</h2>
  <table class="table"><thead><tr><th>Question</th><th>Published</th><th>Readers (30d)</th><th>Clicks (30d)</th><th></th></tr></thead><tbody>
    ${articles.length ? articles.map((a) => `<tr${a.removed_at ? ' class="row-off"' : ''}>
      <td>${a.removed_at ? `<span class="muted">${esc(a.question)}</span> <span class="muted small">(taken down)</span>` : `<a href="/answers/${esc(a.slug)}">${esc(a.question)}</a>`}${a.rewrites ? ` <span class="muted small">· rewritten ${a.rewrites}×</span>` : ''}</td>
      <td>${fmtDate(a.published_at)}</td><td>${a.views}</td><td>${a.clicks}</td>
      <td class="row-actions">${a.removed_at
        ? `<form method="post" action="/dashboard/${esc(p.dashboard_token)}/restore" class="inline"><input type="hidden" name="article_id" value="${a.id}"><button class="btn btn-ghost btn-sm">Put it back</button></form>`
        : `<form method="post" action="/dashboard/${esc(p.dashboard_token)}/rewrite" class="inline" onsubmit="var n=prompt('What should change in the rewrite? (optional)'); if(n===null) return false; this.note.value=n; return true;"><input type="hidden" name="article_id" value="${a.id}"><input type="hidden" name="note" value=""><button class="btn btn-ghost btn-sm">Rewrite $${rewritePrice}</button></form>
           <form method="post" action="/dashboard/${esc(p.dashboard_token)}/takedown" class="inline" onsubmit="return confirm('Take this article down? It comes off the site straight away and you can put it back whenever you want.')"><input type="hidden" name="article_id" value="${a.id}"><button class="btn btn-ghost btn-sm">Take down</button></form>`}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="muted">Nothing published yet. Pick your episodes above and the first ones will be here shortly.</td></tr>'}
  </tbody></table>
  <p class="muted small">A rewrite keeps the same web address, so the page holds any ranking it has built up. Taking an article down removes it from the site and from Google, and putting it back restores it as it was.</p>

  <h2>Readers per day</h2>
  <div class="bars">${daily.map((d) => `<div class="bar" title="${esc(d.day)}: ${d.views} readers, ${d.clicks} clicks"><span style="height:${Math.round((Number(d.views) / maxDay) * 100)}%"></span></div>`).join('')}</div>
  <h2>Where they went to listen</h2>
  <table class="table"><thead><tr><th>Platform</th><th>Clicks</th></tr></thead><tbody>${clicksByPlatform.map((c) => `<tr><td>${esc(PLATFORM_LABEL[c.platform] || (c.platform.charAt(0).toUpperCase() + c.platform.slice(1)))}</td><td>${c.n}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No clicks yet.</td></tr>'}</tbody></table>
  <p class="muted small">Google impressions and rankings arrive in your weekly email. Questions? <a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a></p>
</div></section>
<script>
(function(){
  var f=document.getElementById('pick'); if(!f) return;
  var boxes=[].slice.call(f.querySelectorAll('input[name=episode_id]'));
  var cap=parseInt(boxes[0]&&boxes[0].dataset.cap||'0',10);
  var out=document.getElementById('pickcount'), go=document.getElementById('pickgo');
  function sync(){
    var n=boxes.filter(function(b){return b.checked}).length;
    boxes.forEach(function(b){ b.disabled = !b.checked && n>=cap; });
    out.textContent=n+' of '+cap+' selected';
    go.disabled = n===0;
  }
  boxes.forEach(function(b){b.addEventListener('change',sync)}); sync();
  f.addEventListener('submit',function(){go.disabled=true;go.textContent='Sending...';});
})();
</script>`;
  return layout({ title: `Dashboard: ${p.title}`, description: 'Private dashboard', path: `/dashboard/${p.dashboard_token}`, body, noindex: true });
}

function admin({ leads, podcasts, key }) {
  const body = `
<section class="page-head"><div class="wrap"><h1>Admin</h1></div></section>
<section class="section"><div class="wrap">
  <h2>Leads (${leads.length})</h2>
  <table class="table"><thead><tr><th>When</th><th>Name</th><th>Email</th><th>Podcast</th><th>Feed</th><th>Plan</th><th>Message</th></tr></thead><tbody>
  ${leads.map((l) => `<tr><td>${fmtDate(l.created_at)}</td><td>${esc(l.name)}</td><td><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></td><td>${esc(l.podcast_name)}</td><td>${l.feed_url ? `<a href="${esc(l.feed_url)}">feed</a>` : ''}</td><td>${esc(l.plan)}</td><td>${esc(l.message)}</td></tr>`).join('')}
  </tbody></table>
  <h2>Podcasts (${podcasts.length})</h2>
  <table class="table"><thead><tr><th>Title</th><th>Category</th><th>Tier</th><th>Articles</th><th>Dashboard</th><th></th></tr></thead><tbody>
  ${podcasts.map((p) => `<tr><td><a href="/podcasts/${esc(p.slug)}">${esc(p.title)}</a></td><td>${esc(p.category)}</td><td>
    <form method="post" action="/admin/tier?key=${esc(key)}" class="inline"><input type="hidden" name="id" value="${p.id}"><select name="tier" onchange="this.form.submit()"><option ${p.tier === 'listed' ? 'selected' : ''}>listed</option><option ${p.tier === 'member' ? 'selected' : ''}>member</option><option ${p.tier === 'studio' ? 'selected' : ''}>studio</option></select></form>
  </td><td>${p.articles}</td><td><a href="/dashboard/${esc(p.dashboard_token)}">open</a></td><td><form method="post" action="/admin/feature?key=${esc(key)}" class="inline"><input type="hidden" name="id" value="${p.id}"><button class="btn btn-sm ${p.featured ? 'btn-primary' : 'btn-ghost'}">${p.featured ? 'Featured' : 'Feature'}</button></form></td></tr>`).join('')}
  </tbody></table>
</div></section>`;
  return layout({ title: 'Admin', description: '', path: '/admin', body, noindex: true });
}

function simple(title, description, path, html) {
  return layout({ title, description, path, body: `<section class="page-head"><div class="wrap"><h1>${esc(title)}</h1></div></section><section class="section"><div class="wrap prose">${html}</div></section>` });
}

function transcriptPage({ e, back }) {
  const lines = String(e.transcript).split(/\n+/).filter(Boolean);
  const paras = lines.length > 1 ? lines : String(e.transcript).match(/[^.!?]+[.!?]+(\s|$)/g)?.reduce((acc, sent) => { const last = acc[acc.length - 1]; if (last && last.length < 600) acc[acc.length - 1] = last + sent; else acc.push(sent); return acc; }, []) || [e.transcript];
  const body = `
<section class="page-head"><div class="wrap">
  <p class="eyebrow">Full transcript</p>
  <h1>${esc(e.title)}</h1>
  <p class="lead">${esc(e.ptitle)}${e.author ? ` · ${esc(e.author)}` : ''}${e.published_at ? ` · ${fmtDate(e.published_at)}` : ''}</p>
  <p class="muted small">This transcript was produced automatically and can contain errors. <a class="link" href="${esc(back)}">Back to the article</a> · <a class="link" href="/podcasts/${esc(e.pslug)}/episodes/${esc(e.slug)}">Episode page</a></p>
</div></section>
<section class="section"><div class="wrap prose transcript">
  ${e.audio_url ? `<audio controls preload="none" src="${esc(e.audio_url)}"></audio>` : ''}
  ${paras.map((t) => { const m = String(t).match(/^\[(\d+:\d{2}(?::\d{2})?)\]\s*(.*)$/s); return m ? `<p><span class="ts">${esc(m[1])}</span> ${esc(m[2])}</p>` : `<p>${esc(t)}</p>`; }).join('\n')}
</div></section>`;
  return layout({ title: `Transcript: ${e.title}`, description: `Full transcript of ${e.title} from ${e.ptitle}.`, path: `/transcripts/${e.id}`, body, noindex: true });
}

function notFound() {
  return layout({ title: 'Not found', description: '', path: '/404', noindex: true, body: `<section class="section"><div class="wrap prose"><h1>That page isn't here</h1><p>Try <a href="/answers">browsing the answers</a> or <a href="/topics">pick a topic</a>.</p></div></section>` });
}

module.exports = { SITE, layout, crumbs, home, topicHub, authPage, accountPage, topicsPage, answersIndex, articlePage, podcastsIndex, podcastPage, episodePage, forPodcasters, pricing, forStudios, about, joinPage, blogIndex, blogPost, dashboard, admin, simple, notFound, transcriptPage };
