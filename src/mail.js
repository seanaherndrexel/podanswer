// Outbound email. Resend does the sending; everything we send is logged so a
// missing report is a question we can answer from the database.
const { q } = require('./db');
const { esc } = require('./util');

const KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAIL_FROM || 'PodAnswer <reports@podanswer.com>';
const REPLY_TO = process.env.MAIL_REPLY_TO || process.env.CONTACT_EMAIL || 'sean@mainstreetmakes.com';
const SITE = process.env.SITE_URL || 'https://podanswer.com';

const enabled = () => !!KEY;

const C = {
  ink: '#0c1830', ink2: '#3a4760', muted: '#68758c',
  line: '#e3e8f0', blue: '#1160d8', pale: '#e9f1fd', bgAlt: '#f5f8fd',
};

// Email clients drop <style> blocks and modern CSS, so every rule is inline and
// the layout is tables.
function shell({ preheader, body }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${C.bgAlt};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bgAlt};padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.line};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:22px 28px;border-bottom:1px solid ${C.line};">
  <a href="${SITE}" style="text-decoration:none;"><img src="${SITE}/logo.png" width="150" height="30" alt="PodAnswer" style="display:block;border:0;outline:none;"></a>
</td></tr>
<tr><td style="padding:28px;color:${C.ink};font-size:15px;line-height:1.6;">${body}</td></tr>
<tr><td style="padding:18px 28px;background:${C.bgAlt};border-top:1px solid ${C.line};color:${C.muted};font-size:12px;line-height:1.5;">
  PodAnswer, 152 N Main St, Doylestown PA 18901<br>
  Questions about any of these numbers, reply to this email and you will reach a person.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const btn = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:${C.blue};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">${esc(label)}</a>`;

const h2 = (t) =>
  `<h2 style="margin:28px 0 10px;font-size:15px;font-weight:700;color:${C.ink};letter-spacing:.02em;text-transform:uppercase;">${esc(t)}</h2>`;

// Four numbers across the top. Two columns so it survives a phone.
function statGrid(stats) {
  const cell = (s) => `<td width="50%" style="padding:6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pale};border-radius:10px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:26px;font-weight:800;color:${C.ink};line-height:1.1;">${esc(s.value)}</div>
        <div style="font-size:12px;color:${C.ink2};margin-top:4px;">${esc(s.label)}</div>
        ${s.delta ? `<div style="font-size:12px;color:${s.deltaUp === false ? C.muted : C.blue};margin-top:2px;font-weight:600;">${esc(s.delta)}</div>` : ''}
      </td></tr>
    </table></td>`;
  let out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px;"><tr>';
  stats.forEach((s, i) => {
    out += cell(s);
    if (i % 2 === 1 && i !== stats.length - 1) out += '</tr><tr>';
  });
  if (stats.length % 2 === 1) out += '<td width="50%"></td>';
  return `${out}</tr></table>`;
}

function table(headers, rows) {
  if (!rows.length) return '';
  const th = headers.map((h, i) =>
    `<th align="${i ? 'right' : 'left'}" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${C.muted};border-bottom:1px solid ${C.line};font-weight:700;">${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c, i) =>
    `<td align="${i ? 'right' : 'left'}" style="padding:10px;font-size:14px;color:${i ? C.ink2 : C.ink};border-bottom:1px solid ${C.line};">${c}</td>`).join('')}</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${th}</tr>${tr}</table>`;
}

async function send({ to, subject, html, kind, userId, podcastId, periodStart }) {
  if (!to) return { ok: false, error: 'no recipient' };
  if (!KEY) {
    await log({ to, subject, kind, userId, podcastId, periodStart, status: 'skipped', detail: 'RESEND_API_KEY not set' });
    return { ok: false, error: 'RESEND_API_KEY not set' };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = j && j.message ? j.message : `HTTP ${r.status}`;
      await log({ to, subject, kind, userId, podcastId, periodStart, status: 'failed', detail });
      return { ok: false, error: detail };
    }
    await log({ to, subject, kind, userId, podcastId, periodStart, status: 'sent', providerId: j.id });
    return { ok: true, id: j.id };
  } catch (e) {
    await log({ to, subject, kind, userId, podcastId, periodStart, status: 'failed', detail: e.message });
    return { ok: false, error: e.message };
  }
}

async function log({ to, subject, kind, userId, podcastId, periodStart, status, detail, providerId }) {
  try {
    await q(`INSERT INTO emails (user_id, podcast_id, to_email, kind, subject, period_start, provider_id, status, detail)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId || null, podcastId || null, to, kind, subject || null, periodStart || null, providerId || null, status, detail || null]);
  } catch (e) { console.warn('email log failed', e.message); }
}

/* ---------- templates ---------- */

function welcomeEmail({ name, podcast, plan, quota, dashboardUrl }) {
  const first = (name || '').split(' ')[0];
  const body = `
<p style="margin:0 0 16px;font-size:17px;font-weight:700;">Thanks${first ? `, ${esc(first)}` : ''}. ${esc(podcast || 'Your show')} is in.</p>
<p style="margin:0 0 16px;">Your ${esc(plan)} plan is active and work has already started. Here is the order it happens in.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
  ${[
    ['Today', 'We pull your feed and transcribe the back catalog.'],
    ['This week', `We research what people are searching in your subject and match those questions to the episodes that answer them, then publish the first ${quota} articles.`],
    ['Every week', 'You get an email with impressions, clicks and the questions you are showing up for, straight from Google Search Console.'],
    ['Each month', `${quota} new articles, built from your newest episodes.`],
  ].map(([when, what]) => `<tr>
    <td width="96" valign="top" style="padding:8px 12px 8px 0;font-size:13px;font-weight:700;color:${C.blue};">${esc(when)}</td>
    <td valign="top" style="padding:8px 0;font-size:14px;color:${C.ink2};">${esc(what)}</td></tr>`).join('')}
</table>
<p style="margin:0 0 22px;">${btn(dashboardUrl, 'Open your dashboard')}</p>
<p style="margin:0 0 8px;font-size:14px;color:${C.ink2};">Bookmark that link. It is private to you and it updates daily with reads, listen clicks and which articles are pulling.</p>
<p style="margin:0;font-size:14px;color:${C.ink2};">One thing worth doing now: make sure your show is claimed on Apple Podcasts and Spotify, since those are the two links readers press most.</p>`;
  return {
    subject: `${podcast || 'Your show'} is in: your PodAnswer plan is active`,
    html: shell({ preheader: 'Your plan is active and the first articles are being written.', body }),
  };
}

function weeklyEmail(r) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const delta = (now, prev) => {
    if (!prev) return null;
    const pct = Math.round(((now - prev) / prev) * 100);
    if (!isFinite(pct) || pct === 0) return null;
    return { text: `${pct > 0 ? '+' : ''}${pct}% vs last week`, up: pct > 0 };
  };
  const dImp = delta(r.impressions, r.prevImpressions);
  const dClk = delta(r.clicks, r.prevClicks);

  const stats = [
    { value: fmt(r.impressions), label: 'Google impressions', delta: dImp && dImp.text, deltaUp: dImp && dImp.up },
    { value: fmt(r.clicks), label: 'Clicks from Google', delta: dClk && dClk.text, deltaUp: dClk && dClk.up },
    { value: r.position ? Number(r.position).toFixed(1) : '—', label: 'Average position' },
    { value: fmt(r.listenClicks), label: 'Taps on your listen links' },
  ];

  const pages = (r.topPages || []).slice(0, 5).map((p) => ([
    `<a href="${SITE}/answers/${esc(p.slug)}" style="color:${C.blue};text-decoration:none;">${esc(p.question)}</a>`,
    fmt(p.impressions), fmt(p.clicks),
  ]));
  const queries = (r.topQueries || []).slice(0, 8).map((x) => ([esc(x.query), fmt(x.impressions), fmt(x.clicks)]));
  const PLATFORM = { apple: 'Apple Podcasts', spotify: 'Spotify', youtube: 'YouTube', website: 'Your own site', site: 'Your own site', overcast: 'Overcast', pocketcasts: 'Pocket Casts' };
  const platforms = (r.platforms || []).map((p) => ([esc(PLATFORM[p.platform] || (p.platform.charAt(0).toUpperCase() + p.platform.slice(1))), fmt(p.clicks)]));

  const plain = r.impressions === 0
    ? `<p style="margin:0 0 16px;">Nothing from Google yet this week. New pages usually sit for a few weeks before they start showing up in results, so this is what the first stretch looks like.</p>`
    : '';

  const body = `
<p style="margin:0 0 4px;font-size:17px;font-weight:700;">${esc(r.podcast)}</p>
<p style="margin:0 0 20px;color:${C.muted};font-size:13px;">Week of ${esc(r.periodLabel)}</p>
${plain}
${statGrid(stats)}
${r.newArticles ? `<p style="margin:18px 0 0;font-size:14px;color:${C.ink2};">${r.newArticles} new article${r.newArticles === 1 ? '' : 's'} went live this week. That puts you at ${r.totalArticles} on the site.</p>` : `<p style="margin:18px 0 0;font-size:14px;color:${C.ink2};">You have ${r.totalArticles} article${r.totalArticles === 1 ? '' : 's'} on the site.</p>`}
${pages.length ? h2('Your pages getting seen') + table(['Question', 'Impressions', 'Clicks'], pages) : ''}
${queries.length ? h2('What people searched to find you') + table(['Search', 'Impressions', 'Clicks'], queries) : ''}
${platforms.length ? h2('Where readers went to listen') + table(['Platform', 'Taps'], platforms) : ''}
<p style="margin:28px 0 18px;">${btn(r.dashboardUrl, 'See the full dashboard')}</p>
<p style="margin:0 0 10px;font-size:13px;color:${C.muted};">Impressions and clicks come from Google Search Console for the pages we publish for your show. Listen taps are counted on our side when a reader presses through to Apple, Spotify or your site.</p>
${r.optOutUrl ? `<p style="margin:0;font-size:12px;color:${C.muted};"><a href="${r.optOutUrl}" style="color:${C.muted};">Stop sending this weekly email</a></p>` : ''}`;

  return {
    subject: `${r.podcast}: ${fmt(r.impressions)} impressions, ${fmt(r.clicks)} clicks last week`,
    html: shell({ preheader: `${fmt(r.impressions)} impressions and ${fmt(r.clicks)} clicks from Google in the last seven days.`, body }),
  };
}

// Sent once a batch of requested articles finishes.
function articlesReadyEmail({ name, podcast, done, failed, dashboardUrl }) {
  const first = (name || '').split(' ')[0];
  const list = (done || []).map((a) => `<tr>
    <td style="padding:12px 0;border-bottom:1px solid ${C.line};">
      <a href="${SITE}/answers/${esc(a.slug)}" style="color:${C.blue};text-decoration:none;font-weight:600;font-size:15px;">${esc(a.question)}</a>
      ${a.target_query ? `<div style="font-size:13px;color:${C.muted};margin-top:3px;">Targeting: ${esc(a.target_query)}</div>` : ''}
    </td></tr>`).join('');

  const n = (done || []).length;
  const body = `
<p style="margin:0 0 16px;font-size:17px;font-weight:700;">${n ? `${n} new article${n === 1 ? '' : 's'} for ${esc(podcast)}` : `An update on ${esc(podcast)}`}</p>
${n ? `<p style="margin:0 0 6px;">${first ? `${esc(first)}, these` : 'These'} are live now. Each one answers the search phrase with the most traffic behind it that your episode genuinely answers, and every quote links back to the minute you said it.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px;">${list}</table>` : ''}
${(failed || []).length ? `<p style="margin:20px 0 6px;font-size:14px;color:${C.ink2};">${failed.length} did not go through:</p>
<ul style="margin:0 0 4px;padding-left:20px;color:${C.ink2};font-size:14px;">${failed.map((f) => `<li style="margin-bottom:5px;">${esc(f.episode_title || 'An episode')}: ${esc(f.detail || 'we could not complete it')}</li>`).join('')}</ul>
<p style="margin:8px 0 0;font-size:14px;color:${C.ink2};">Those did not count against your allowance, so you can pick different episodes whenever you like.</p>` : ''}
<p style="margin:24px 0 18px;">${btn(dashboardUrl, 'Open your dashboard')}</p>
<p style="margin:0;font-size:14px;color:${C.ink2};">Read one that misses the mark? There is a rewrite button on each article in your dashboard, and a take-down button if you would rather it came off the site.</p>`;
  return {
    subject: n ? `${n} new article${n === 1 ? '' : 's'} live for ${podcast}` : `An update on ${podcast}`,
    html: shell({ preheader: n ? `${n} new article${n === 1 ? '' : 's'} published for ${podcast}.` : 'An update on your article requests.', body }),
  };
}

module.exports = { enabled, send, shell, welcomeEmail, weeklyEmail, articlesReadyEmail, C };
