const crypto = require('crypto');

// Each topic is its own silo: unique H1, unique intro copy, and its own hub page.
// Google judges depth per section, so no two hubs describe themselves the same way.
const CATEGORIES = {
  business: {
    name: 'Business', h1: 'Running a business, answered',
    blurb: 'Pricing, hiring, cash flow and the trades.',
    intro: 'Most business questions have a right answer that depends on your numbers, and the people who give it plainly are usually the ones running the business, not writing about it. These answers come from operators talking on their own shows about pricing jobs, hiring crews, chasing invoices and deciding when to grow.',
  },
  marketing: {
    name: 'Marketing', h1: 'Marketing questions, answered by people doing it',
    blurb: 'Ads, SEO, social, branding and copy.',
    intro: 'Marketing advice ages fast and most of what ranks is written to rank rather than to help. These answers come from practitioners describing what they ran, what it cost, and what happened.',
  },
  money: {
    name: 'Money', h1: 'Personal finance, answered',
    blurb: 'Saving, investing, taxes and retirement.',
    intro: 'Money questions get vague answers because the honest one is usually specific. These are taken from advisors and planners working through real situations out loud, with the numbers left in. None of it is personalised advice, and a decision this size deserves a conversation with someone licensed.',
  },
  'real-estate': {
    name: 'Real Estate', h1: 'Buying, selling and owning property, answered',
    blurb: 'Homes, mortgages, landlords and investing.',
    intro: 'Property questions turn on local rules and current rates, so the useful answers come with context attached. These come from agents, landlords and investors explaining how a particular deal worked.',
  },
  law: {
    name: 'Law', h1: 'Legal questions in plain English',
    blurb: 'Estates, family, business and employment.',
    intro: 'Lawyers explain things clearly when they are talking rather than drafting. These answers are taken from attorneys walking through how a process runs in practice. It is general information, not legal advice, and your situation may turn on facts a podcast cannot know.',
  },
  health: {
    name: 'Health', h1: 'Health questions, answered by clinicians and coaches',
    blurb: 'Sleep, nutrition, longevity and everyday wellness.',
    intro: 'These answers come from practitioners explaining mechanisms and trade-offs on their own shows. They are general education, not a diagnosis, and anything that concerns you belongs in front of your own doctor.',
  },
  fitness: {
    name: 'Fitness', h1: 'Training questions, answered',
    blurb: 'Strength, running, cycling and mobility.',
    intro: 'Training advice is full of confident opinions. These answers come from coaches explaining why a method works, who it suits, and what they would do differently.',
  },
  science: {
    name: 'Science', h1: 'Science questions, answered',
    blurb: 'Nature, space, climate and the physical world.',
    intro: 'Researchers and science communicators explaining their own field in conversation, with the hedges and the uncertainty left in.',
  },
  history: {
    name: 'History', h1: 'History questions, answered',
    blurb: 'Eras, wars, places and everyday life in the past.',
    intro: 'Historians and obsessive amateurs going deep on a specific period, and answering the question you would actually ask if you met them.',
  },
  technology: {
    name: 'Technology', h1: 'Technology questions, answered in plain English',
    blurb: 'AI, security, software and the tools you use.',
    intro: 'Answers from people who build and break this stuff, aimed at someone who wants to understand it rather than sell it.',
  },
  productivity: {
    name: 'Productivity', h1: 'Getting things done, answered',
    blurb: 'Habits, focus, time and organisation.',
    intro: 'Most productivity advice sells a system. These answers explain what a method is doing, who it suits, and the point at which it stops working, from people who changed how they work and reported back.',
  },
  psychology: {
    name: 'Psychology', h1: 'People and relationships, answered',
    blurb: 'Communication, confidence, stress and family.',
    intro: 'Conversations about how people think and relate, from therapists, coaches and researchers. Educational rather than clinical, and no substitute for talking to someone who knows you.',
  },
  parenting: {
    name: 'Parenting', h1: 'Parenting questions, answered',
    blurb: 'Newborns, teens, school and family logistics.',
    intro: 'Practical answers from people who have handled the stage you are in, with the caveats left in rather than smoothed over.',
  },
  home: {
    name: 'Home & Garden', h1: 'Home and garden questions, answered',
    blurb: 'Repairs, renovations, design and growing things.',
    intro: 'Contractors, designers and growers explaining what a job involves, what it costs and where people get it wrong. Useful whether you are doing it yourself or hiring it out.',
  },
  food: {
    name: 'Food & Drink', h1: 'Cooking and drinking, answered',
    blurb: 'Technique, baking, coffee and wine.',
    intro: 'Cooks and makers explaining technique, which is the part recipes leave out.',
  },
  careers: {
    name: 'Careers', h1: 'Work and careers, answered',
    blurb: 'Job searching, interviews, negotiation and leadership.',
    intro: 'Recruiters, negotiators and people who changed direction, describing what changed the outcome rather than what sounds good on a résumé.',
  },
  education: {
    name: 'Education', h1: 'Learning and teaching, answered',
    blurb: 'Study skills, languages, school and admissions.',
    intro: 'Teachers, tutors and researchers on what makes learning stick, and what to do when it is not sticking.',
  },
  engineering: {
    name: 'Engineering', h1: 'Engineering questions, answered by working engineers',
    blurb: 'Building, software, manufacturing and design.',
    intro: 'Engineering answers are worth most when they come with the constraints attached. These come from engineers on their own shows explaining how a system was built, what broke, and what they would specify next time.',
  },
  creative: {
    name: 'Art & Creative', h1: 'Creative work, answered',
    blurb: 'Writing, photography, music, video and podcasting.',
    intro: 'Working creatives explaining craft and the business around it, including the parts that are unglamorous.',
  },
};

function slugify(s) {
  return String(s || '')
    .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 90);
}

const token = () => crypto.randomBytes(12).toString('hex');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmtDuration(sec) {
  if (!sec) return '';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

// Shows that don't answer searchable questions get nothing from the service, so they can't buy it.
const NOT_ELIGIBLE = ['comedy', 'fiction and audio drama', 'true crime storytelling', 'sports talk', 'celebrity and pop culture', 'news commentary', 'music'];

module.exports = { NOT_ELIGIBLE, CATEGORIES, slugify, token, esc, fmtDate, fmtDuration };
