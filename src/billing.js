// Stripe Checkout (hosted, so card details never touch this server) + webhooks.
const { q } = require('./db');

const { slugify, token } = require('./util');
const bcrypt = require('bcryptjs');

const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

const PLANS = {
  growth: { name: 'Growth', quota: 4, priceEnv: 'STRIPE_PRICE_GROWTH', amount: '$149/month' },
  network: { name: 'Network', quota: 12, priceEnv: 'STRIPE_PRICE_NETWORK', amount: '$349/month' },
};

const enabled = () => !!stripe && !!process.env.STRIPE_PRICE_GROWTH;

// --- purchases that arrive from a shareable payment link (no logged-in session) ---

const customFields = (s) => (s.custom_fields || []).reduce((acc, f) => {
  acc[f.key] = (f.text && f.text.value) || (f.dropdown && f.dropdown.value) || (f.numeric && f.numeric.value) || '';
  return acc;
}, {});

// Which package was bought: session metadata first, then the price the link charged.
async function planFromSession(s) {
  const meta = s.metadata || {};
  if (meta.plan && PLANS[meta.plan]) return meta.plan;
  try {
    const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 1 });
    const price = items.data[0] && items.data[0].price;
    if (price) {
      if (price.id === process.env.STRIPE_PRICE_NETWORK) return 'network';
      if (price.id === process.env.STRIPE_PRICE_GROWTH) return 'growth';
      if (price.metadata && PLANS[price.metadata.plan]) return price.metadata.plan;
    }
  } catch { /* fall through to the default */ }
  return 'growth';
}

// Match the buyer to an account by email, creating a claimable one if they have never signed up.
async function userFromCheckout(s) {
  const email = (s.customer_details && s.customer_details.email) || s.customer_email || '';
  if (!email) return null;
  const found = (await q(`SELECT * FROM users WHERE email=lower($1)`, [email])).rows[0];
  const user = found || (await q(
    `INSERT INTO users (email, password_hash, name) VALUES (lower($1),$2,$3) RETURNING *`,
    [email, await bcrypt.hash(token(), 10), (s.customer_details && s.customer_details.name) || null]
  )).rows[0];
  if (s.customer && !user.stripe_customer_id) {
    await q(`UPDATE users SET stripe_customer_id=$2 WHERE id=$1`, [user.id, s.customer]);
    user.stripe_customer_id = s.customer;
  }
  return user;
}

async function customerFor(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const c = await stripe.customers.create({ email: user.email, name: user.name || undefined, metadata: { user_id: String(user.id) } });
  await q(`UPDATE users SET stripe_customer_id=$2 WHERE id=$1`, [user.id, c.id]);
  return c.id;
}

async function createCheckout({ user, plan, podcast, siteUrl }) {
  const cfg = PLANS[plan];
  if (!cfg) throw new Error('unknown plan');
  const price = process.env[cfg.priceEnv];
  if (!price) throw new Error(`${cfg.priceEnv} not set`);
  const customer = await customerFor(user);
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${siteUrl}/account?welcome=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/account?canceled=1`,
    subscription_data: { metadata: { user_id: String(user.id), podcast_id: String(podcast ? podcast.id : ''), plan } },
    metadata: { user_id: String(user.id), podcast_id: String(podcast ? podcast.id : ''), plan },
  });
}

// A rewrite is a one-off charge. The price is built inline so there is no extra
// product to keep in step in the Stripe dashboard.
async function createRewriteCheckout({ podcast, article, orderId, amount, siteUrl }) {
  const customer = podcast.user_id
    ? await customerFor((await q(`SELECT * FROM users WHERE id=$1`, [podcast.user_id])).rows[0])
    : undefined;
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer,
    customer_email: customer ? undefined : (podcast.owner_email || undefined),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: amount,
        product_data: {
          name: 'Article rewrite',
          description: String(article.question || '').slice(0, 180),
        },
      },
    }],
    success_url: `${siteUrl}/dashboard/${podcast.dashboard_token}?rewrite=paid`,
    cancel_url: `${siteUrl}/dashboard/${podcast.dashboard_token}?rewrite=canceled`,
    metadata: { kind: 'rewrite', order_id: String(orderId), podcast_id: String(podcast.id), article_id: String(article.id) },
    payment_intent_data: { metadata: { kind: 'rewrite', order_id: String(orderId) } },
  });
}

async function billingPortal({ user, siteUrl }) {
  const customer = await customerFor(user);
  return stripe.billingPortal.sessions.create({ customer, return_url: `${siteUrl}/account` });
}

// Turns a paid subscription into an active member podcast and queues the first run.
async function activate({ userId, podcastId, plan, subscriptionId, customerId, periodEnd }) {
  const cfg = PLANS[plan] || PLANS.growth;
  const sub = (await q(
    `INSERT INTO subscriptions (user_id, podcast_id, stripe_customer_id, stripe_subscription_id, plan, quota, status, current_period_end)
     VALUES ($1,$2,$3,$4,$5,$6,'active',$7)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET status='active', plan=EXCLUDED.plan, quota=EXCLUDED.quota,
       podcast_id=COALESCE(EXCLUDED.podcast_id, subscriptions.podcast_id), current_period_end=EXCLUDED.current_period_end, updated_at=now()
     RETURNING *`,
    [userId, podcastId || null, customerId || null, subscriptionId, plan, cfg.quota, periodEnd || null]
  )).rows[0];

  welcome(sub).catch((e) => console.warn('welcome email failed', e.message));

  if (sub.podcast_id) {
    await q(`UPDATE podcasts SET tier='member', updated_at=now() WHERE id=$1`, [sub.podcast_id]);
    // New member: pull their feed now so episodes and ideas are ready when they open the dashboard.
    try { const p = (await q(`SELECT * FROM podcasts WHERE id=$1`, [sub.podcast_id])).rows[0]; if (p) require('./ingest').ingestPodcast(p).catch(() => {}); } catch { /* the daily ingest will catch it */ }
    return { sub, job: null };
  }
  return { sub, job: null };
}

// The thank-you goes out once per subscription, however the subscription arrived.
async function welcome(sub) {
  if (!sub || sub.welcomed_at) return;
  const { sendWelcome } = require('./reports');
  const user = sub.user_id ? (await q(`SELECT * FROM users WHERE id=$1`, [sub.user_id])).rows[0] : null;
  const podcast = sub.podcast_id ? (await q(`SELECT * FROM podcasts WHERE id=$1`, [sub.podcast_id])).rows[0] : null;
  const r = await sendWelcome({ user, podcast, plan: sub.plan, quota: sub.quota });
  if (r && r.ok) await q(`UPDATE subscriptions SET welcomed_at=now() WHERE id=$1`, [sub.id]);
}

// Hand off to Make, which runs the work and tells Sean what happened.
async function notify(job, sub) {
  if (!process.env.MAKE_JOB_WEBHOOK) return;
  const p = job && job.podcast_id ? (await q(`SELECT * FROM podcasts WHERE id=$1`, [job.podcast_id])).rows[0] : null;
  await fetch(process.env.MAKE_JOB_WEBHOOK, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: job.kind === 'onboard' ? 'subscription.activated' : 'monthly.run',
      job_id: job.id, quota: job.quota,
      podcast_id: job.podcast_id, podcast: p ? p.title : null, feed_url: p ? p.feed_url : null,
      plan: sub ? sub.plan : null,
      run_url: `${process.env.SITE_URL || 'https://podanswer.com'}/api/jobs/${job.id}/run`,
      secret: process.env.JOB_SECRET || '',
    }),
  });
}

async function handleWebhook(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) throw new Error('stripe webhook not configured');
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const meta = s.metadata || {};

    // a paid rewrite: release the order and let the runner pick it up
    if (meta.kind === 'rewrite' && meta.order_id) {
      await q(`UPDATE article_orders SET status='queued' WHERE id=$1 AND status='awaiting_payment'`, [parseInt(meta.order_id, 10)]);
      // The daily writer picks queued orders up through /api/content/orders.
      return event.type;
    }
    if (s.mode === 'payment') return event.type;

    const subscription = s.subscription ? await stripe.subscriptions.retrieve(s.subscription) : null;
    const plan = await planFromSession(s);
    let userId = parseInt(meta.user_id, 10) || null;
    let podcastId = parseInt(meta.podcast_id, 10) || null;

    if (!userId) { // bought through a payment link rather than from inside an account
      const user = await userFromCheckout(s);
      if (!user) { console.error('stripe checkout with no user or email', s.id); return event.type; }
      userId = user.id;
      const cf = customFields(s);
      if (!podcastId && (cf.podcastname || cf.feedurl)) {
        const p = await ensurePodcastForUser(user, { title: cf.podcastname || `${user.email} show`, feedUrl: cf.feedurl || '', category: 'business' });
        podcastId = p.id;
      }
    }

    await activate({
      userId,
      podcastId,
      plan,
      subscriptionId: s.subscription,
      customerId: s.customer,
      periodEnd: subscription && subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
    });
  }

  // Each monthly renewal buys another batch of articles.
  if (event.type === 'invoice.paid') {
    const inv = event.data.object;
    if (inv.subscription && inv.billing_reason === 'subscription_cycle') {
      const sub = (await q(`SELECT * FROM subscriptions WHERE stripe_subscription_id=$1`, [inv.subscription])).rows[0];
      if (sub && sub.podcast_id) {
        await q(`UPDATE subscriptions SET status='active', current_period_end=$2, updated_at=now() WHERE id=$1`,
          [sub.id, inv.period_end ? new Date(inv.period_end * 1000) : null]);

      }
    }
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.paused') {
    const s = event.data.object;
    await q(`UPDATE subscriptions SET status='canceled', updated_at=now() WHERE stripe_subscription_id=$1`, [s.id]);
    await q(`UPDATE podcasts SET tier='listed', updated_at=now() WHERE id=(SELECT podcast_id FROM subscriptions WHERE stripe_subscription_id=$1)`, [s.id]);
  }

  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object;
    if (inv.subscription) await q(`UPDATE subscriptions SET status='past_due', updated_at=now() WHERE stripe_subscription_id=$1`, [inv.subscription]);
  }

  return event.type;
}

// A podcast row the subscriber owns, created from what they typed on the form.
async function ensurePodcastForUser(user, { title, feedUrl, category }) {
  const existing = (await q(`SELECT * FROM podcasts WHERE user_id=$1 ORDER BY id LIMIT 1`, [user.id])).rows[0];
  if (existing) {
    await q(`UPDATE podcasts SET title=COALESCE(NULLIF($2,''), title), feed_url=COALESCE(NULLIF($3,''), feed_url), category=COALESCE(NULLIF($4,''), category), updated_at=now() WHERE id=$1`,
      [existing.id, title || '', feedUrl || '', category || '']);
    return (await q(`SELECT * FROM podcasts WHERE id=$1`, [existing.id])).rows[0];
  }
  let slug = slugify(title) || `show-${user.id}`;
  if ((await q(`SELECT 1 FROM podcasts WHERE slug=$1`, [slug])).rows.length) slug = `${slug}-${user.id}`;
  const r = await q(
    `INSERT INTO podcasts (slug, title, category, feed_url, tier, dashboard_token, owner_email, user_id)
     VALUES ($1,$2,$3,$4,'listed',$5,$6,$7) RETURNING *`,
    [slug, title, category || 'business', feedUrl || '', token(), user.email, user.id]);
  // One feed read when the show is first listed, so the page is not empty.
  // Free listings are never refreshed again and never hit a paid API.
  if (r.rows[0].feed_url) {
    try { require('./ingest').ingestPodcast(r.rows[0], { limit: 10 }).catch(() => {}); } catch { /* listing still works */ }
  }
  return r.rows[0];
}

module.exports = { stripe, enabled, PLANS, welcome, createRewriteCheckout, createCheckout, billingPortal, handleWebhook, activate, ensurePodcastForUser, billingPortalEnabled: enabled, notify };
