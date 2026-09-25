// Refreshes episodes for every podcast from its RSS feed.
// Run daily as a Render cron job: `node src/ingest.js`
// For member/studio podcasts it also stores transcripts: the feed's own
// <podcast:transcript> first, then YouTube captions, then AssemblyAI when
// ASSEMBLYAI_API_KEY is set. Free listings get metadata only.
const Parser = require('rss-parser');
const { q, pool } = require('./db');
const { slugify } = require('./util');

const parser = new Parser({
  timeout: 20000,
  customFields: {
    item: [['podcast:transcript', 'transcripts', { keepArray: true }], ['itunes:duration', 'duration'], ['itunes:summary', 'itunesSummary']],
    feed: [['itunes:author', 'itunesAuthor'], ['itunes:image', 'itunesImage']],
  },
});

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function parseDuration(d) {
  if (!d) return null;
  if (/^\d+$/.test(d)) return parseInt(d, 10);
  const parts = String(d).split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

async function fetchTranscriptText(url, type) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'PodAnswerBot/1.0 (+https://podanswer.com)' } });
    if (!r.ok) return null;
    const text = await r.text();
    if (/json/i.test(type || '') || text.trim().startsWith('{')) {
      try { const j = JSON.parse(text); if (j.segments) return j.segments.map((s) => s.body).join(' '); } catch { /* fallthrough */ }
    }
    if (/srt|vtt/i.test(type || '') || /^WEBVTT/.test(text) || /-->/.test(text)) {
      return text.split('\n').filter((l) => l && !/-->/.test(l) && !/^\d+$/.test(l) && !/^WEBVTT/.test(l)).join(' ').replace(/\s+/g, ' ');
    }
    return stripHtml(text).slice(0, 200000);
  } catch { return null; }
}

// AssemblyAI: the transcription engine used for paying members' episodes when the feed carries no
// transcript. It downloads the audio itself from the episode's audio link (no size limit up to 10 hours),
// labels the speakers, and returns timestamped utterances. About $0.23 an audio hour with speaker labels.
async function transcribeAudio(audioUrl) {
  const KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!KEY || !audioUrl) return null;
  try {
    const start = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST', headers: { authorization: KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, speaker_labels: true, punctuate: true, format_text: true }),
    });
    if (!start.ok) { console.warn('assemblyai submit', start.status, (await start.text()).slice(0, 200)); return null; }
    const { id } = await start.json();
    const deadline = Date.now() + 45 * 60 * 1000;
    let j = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15000));
      const r = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: { authorization: KEY } });
      if (!r.ok) continue;
      j = await r.json();
      if (j.status === 'completed' || j.status === 'error') break;
    }
    if (!j || j.status !== 'completed') { console.warn('assemblyai', id, j ? j.status : 'timeout', j && j.error); return null; }
    const utt = j.utterances || [];
    const text = utt.length
      ? utt.map((u) => `[${fmtTs(Math.floor((u.start || 0) / 1000))}] Speaker ${u.speaker}: ${String(u.text || '').trim()}`).join('\n')
      : (j.text || '');
    return text.length > 200 ? text.slice(0, 400000) : null;
  } catch (e) { console.warn('assemblyai failed', e.message); return null; }
}

/* ---------- free transcripts from YouTube captions ----------
   Most podcasts also publish to YouTube, and YouTube auto-captions every upload. If the show
   has a channel on file (podcasts.youtube_url) or the episode links to a YouTube video, we
   match the episode to its video and pull the caption track. No paid API involved. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const norm = (t) => String(t || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|a|an|and|of|to|in|with|on|for|ep|episode)\b/g, ' ').replace(/\s+/g, ' ').trim();
function titleScore(a, b) {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 2)), B = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}
function videoIdFromUrl(u) {
  const m = String(u || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
async function channelVideos(channelUrl) {
  try {
    let base = String(channelUrl).replace(/\/+$/, '').replace(/\/(videos|streams|featured)$/, '');
    if (videoIdFromUrl(base)) return [];
    const r = await fetch(`${base}/videos`, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1' } });
    if (!r.ok) return [];
    const html = await r.text();
    const out = []; const seen = new Set();
    const push = (id, title) => { if (id && title && !seen.has(id)) { seen.add(id); out.push({ id, title }); } };
    const m0 = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (m0) {
      try {
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o)) { o.forEach(walk); return; }
          if (o.lockupViewModel) { const lv = o.lockupViewModel; push(lv.contentId, lv.metadata && lv.metadata.lockupMetadataViewModel && lv.metadata.lockupMetadataViewModel.title && lv.metadata.lockupMetadataViewModel.title.content); }
          if (o.videoRenderer) { const vr = o.videoRenderer; push(vr.videoId, vr.title && vr.title.runs && vr.title.runs.map((x) => x.text).join('')); }
          Object.values(o).forEach(walk);
        };
        walk(JSON.parse(m0[1]));
      } catch { /* fall through to regex */ }
    }
    if (!out.length) {
      const re = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;
      let m; while ((m = re.exec(html)) && out.length < 120) push(m[1], JSON.parse(`"${m[2]}"`));
    }
    return out.slice(0, 150);
  } catch { return []; }
}
async function captionTracks(videoId) {
  // 1) innertube with a mobile client, which usually skips the "sign in to confirm you're not a bot" wall on server IPs
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip', 'x-youtube-client-name': '3', 'x-youtube-client-version': '19.09.37' },
      body: JSON.stringify({ videoId, context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en', gl: 'US' } }, contentCheckOk: true, racyCheckOk: true }),
    });
    if (r.ok) {
      const j = await r.json();
      const tracks = j.captions && j.captions.playerCaptionsTracklistRenderer && j.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (tracks && tracks.length) return tracks;
    }
  } catch { /* try the page */ }
  // 2) the watch page
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1' } });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/"captionTracks":(\[.*?\])/);
    if (!m) return null;
    return JSON.parse(m[1].replace(/\\u0026/g, '&'));
  } catch { return null; }
}
async function captionsForVideo(videoId) {
  try {
    const tracks = await captionTracks(videoId);
    if (!tracks || !tracks.length) return null;
    const pick = tracks.find((t) => /^en/.test(t.languageCode) && t.kind !== 'asr') || tracks.find((t) => /^en/.test(t.languageCode)) || tracks[0];
    const url = pick.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';
    const c = await fetch(url, { headers: { 'user-agent': UA } });
    if (!c.ok) return null;
    const j = await c.json();
    const lines = [];
    let bucketStart = null, bucket = [];
    for (const ev of j.events || []) {
      if (!ev.segs) continue;
      const text = ev.segs.map((sg) => sg.utf8 || '').join('').replace(/\n/g, ' ').trim();
      if (!text) continue;
      const t = Math.floor((ev.tStartMs || 0) / 1000);
      if (bucketStart === null) bucketStart = t;
      bucket.push(text);
      if (t - bucketStart >= 30) { lines.push(`[${fmtTs(bucketStart)}] ${bucket.join(' ')}`); bucket = []; bucketStart = null; }
    }
    if (bucket.length) lines.push(`[${fmtTs(bucketStart || 0)}] ${bucket.join(' ')}`);
    const text = lines.join('\n');
    return text.length > 500 ? text.slice(0, 400000) : null;
  } catch { return null; }
}
function fmtTs(s) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:` : '') + `${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`; }
async function youtubeTranscript(p, episode) {
  let vid = videoIdFromUrl(episode.episode_url);
  if (!vid && p.youtube_url) {
    const vids = await channelVideos(p.youtube_url);
    let best = null, bestScore = 0;
    for (const v of vids) { const sc = titleScore(episode.title, v.title); if (sc > bestScore) { best = v; bestScore = sc; } }
    if (best && bestScore >= 0.6) vid = best.id;
  }
  if (!vid) return null;
  return captionsForVideo(vid);
}

async function ingestPodcast(p, { limit = 25 } = {}) {
  if (!p.feed_url) return { added: 0 };
  let feed;
  try { feed = await parser.parseURL(p.feed_url); } catch (e) { console.warn('feed failed', p.slug, e.message); return { added: 0, error: e.message }; }
  const updates = {};
  if (feed.image && feed.image.url && !p.image_url) updates.image_url = feed.image.url;
  if (feed.itunesImage && feed.itunesImage.$ && feed.itunesImage.$.href && !p.image_url) updates.image_url = feed.itunesImage.$.href;
  if (feed.link && !p.website) updates.website = feed.link;
  if (feed.itunesAuthor && !p.author) updates.author = feed.itunesAuthor;
  if (Object.keys(updates).length) {
    const sets = Object.keys(updates).map((k, i) => `${k}=$${i + 2}`).join(', ');
    await q(`UPDATE podcasts SET ${sets}, updated_at=now() WHERE id=$1`, [p.id, ...Object.values(updates)]);
  }
  let added = 0;
  // New members: transcribe their newest 15 episodes on the first pass so the dashboard ideas and the
  // first articles quote real speech. After that the daily run only meets new releases. Older episodes
  // are transcribed the moment a member orders one (see /api/content/transcribe).
  let paidLeft = parseInt(process.env.TRANSCRIBE_MAX_PER_RUN || '15', 10);
  for (const item of (feed.items || []).slice(0, limit)) {
    const guid = item.guid || item.id || item.link || item.title;
    if (!guid || !item.title) continue;
    const exists = await q(`SELECT id, transcript FROM episodes WHERE podcast_id=$1 AND guid=$2`, [p.id, guid]);
    const summary = stripHtml(item.contentSnippet || item.itunesSummary || item.content || '').slice(0, 1200);
    const audioUrl = item.enclosure && item.enclosure.url;
    const t = (item.transcripts || []).find((x) => x && x.$ && x.$.url);
    const transcriptUrl = t ? t.$.url : '';
    let slug = slugify(item.title);
    if (exists.rows.length) {
      await q(`UPDATE episodes SET title=$3, summary=$4, transcript_url=COALESCE(NULLIF($5,''), transcript_url) WHERE podcast_id=$1 AND guid=$2`, [p.id, guid, item.title, summary, transcriptUrl]);
    } else {
      const clash = await q(`SELECT 1 FROM episodes WHERE podcast_id=$1 AND slug=$2`, [p.id, slug]);
      if (clash.rows.length) slug = `${slug}-${slugify(guid).slice(-8)}`;
      await q(`INSERT INTO episodes (podcast_id, guid, slug, title, published_at, summary, audio_url, duration_sec, episode_url, transcript_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [p.id, guid, slug, item.title, item.isoDate ? item.isoDate.slice(0, 10) : null, summary, audioUrl || '', parseDuration(item.duration), item.link || '', transcriptUrl]);
      added++;
    }
    // transcripts only for paying members
    if (p.tier !== 'listed') {
      const row = (await q(`SELECT id, title, transcript, audio_url, transcript_url, episode_url, duration_sec FROM episodes WHERE podcast_id=$1 AND guid=$2`, [p.id, guid])).rows[0];
      if (row && !row.transcript) {
        let text = row.transcript_url ? await fetchTranscriptText(row.transcript_url, t && t.$ && t.$.type) : null;
        let source = text ? 'rss' : null;
        if (!text) { text = await youtubeTranscript(p, row); if (text) source = 'youtube'; }
        if (!text && row.audio_url && paidLeft > 0) { paidLeft--; text = await transcribeAudio(row.audio_url); if (text) source = 'assemblyai'; }
        if (text) await q(`UPDATE episodes SET transcript=$2, transcript_source=$3 WHERE id=$1`, [row.id, text, source]);
      }
    }
  }
  return { added };
}

async function run() {
  const only = process.argv[2]; // optional slug
  // Free listings cost nothing to keep: the daily run only touches paying shows.
  // Pass a slug, or set INGEST_ALL=1, to refresh a free listing on purpose.
  const includeFree = !!only || process.env.INGEST_ALL === '1';
  const where = only ? 'WHERE slug=$1' : (includeFree ? '' : "WHERE tier <> 'listed'");
  const pods = (await q(`SELECT * FROM podcasts ${where} ORDER BY (tier <> 'listed') DESC, updated_at ASC`, only ? [only] : [])).rows;
  let total = 0;
  for (const p of pods) {
    const r = await ingestPodcast(p);
    total += r.added || 0;
    console.log(p.slug, r);
  }
  console.log(`ingest complete: ${total} new episodes across ${pods.length} podcasts`);
}

if (require.main === module) run().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
async function transcribeEpisode(e) {
  let text = e.transcript_url ? await fetchTranscriptText(e.transcript_url, '') : null;
  let source = text ? 'rss' : null;
  if (!text) { text = await youtubeTranscript({ youtube_url: e.youtube_url }, e); if (text) source = 'youtube'; }
  if (!text && e.audio_url) { text = await transcribeAudio(e.audio_url); if (text) source = 'assemblyai'; }
  if (text) await q(`UPDATE episodes SET transcript=$2, transcript_source=$3 WHERE id=$1`, [e.id, text, source]);
  return { ok: !!text, source, chars: text ? text.length : 0 };
}
module.exports = { ingestPodcast, youtubeTranscript, transcribeEpisode };
