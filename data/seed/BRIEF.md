# Seed brief for PodAnswer

PodAnswer (podanswer.com) is a podcast network site. Each page answers a real question people type into Google, using what an expert said on a podcast episode, then links to the podcast. Your job: collect real podcasts and write one answer article per podcast.

## Constraints
- Shell has NO internet except GitHub/npm. Use the WebFetch tool for everything on the web. WebSearch also works.
- Real podcasts only, real feed URLs, real episodes. Never invent an episode, a quote, or a URL. If you can't verify something, leave the field empty.
- Podcasts must be educational/informational and in English, currently active (an episode in the last ~6 months), and NOT giant network shows (skip anything from NPR, iHeart, Wondery, NYT, BBC, Spotify Studios, Joe Rogan etc.). Target independent shows with a real host who'd plausibly want promotion: solo experts, small business owners, practitioners.
- Quotes: only quote text you actually saw in a transcript or the episode's own show notes. Keep each quote under 40 words. If you have no verifiable quote, use `"quote": null` and paraphrase in the body instead (say "the host explains that…").

## How to find podcasts
1. The iTunes API and podcastindex.org are blocked. Use WebSearch instead. Good queries: `"<topic> podcast" rss.buzzsprout.com`, `<topic> podcast feeds.libsyn.com`, `<topic> podcast feeds.transistor.fm`, `<topic> podcast site:feeds.captivate.fm`, `<topic> podcast rss feed`, and `site:podcast.feedspot.com <topic> podcasts` (Feedspot lists independent shows per topic; WebFetch the Feedspot page and ask for each show's name, website and RSS feed URL). Podcast hosts with predictable feeds: Buzzsprout (`https://feeds.buzzsprout.com/<id>.rss`), Libsyn (`https://<show>.libsyn.com/rss`), Transistor (`https://feeds.transistor.fm/<show>`), Captivate (`https://feeds.captivate.fm/<show>/`), Podbean (`https://feed.podbean.com/<show>/feed.xml`), Anchor/Spotify (`https://anchor.fm/s/<id>/podcast/rss`), Simplecast (`https://feeds.simplecast.com/<id>`), Megaphone (`https://feeds.megaphone.fm/<id>`).
2. WebFetch the feedUrl. Ask for: channel title, author, description, link (website), image URL, and for the 6 most recent items: title, pubDate, guid, link, enclosure url, itunes:duration, a 2-3 sentence summary of the description, and any `<podcast:transcript url="...">` URLs.
3. If a transcript URL exists, WebFetch it and ask for the 6-10 most useful verbatim passages on the episode's main topic (each under 40 words, with rough timestamps if present).
4. Pick the ONE episode with the most concrete, searchable advice. Write the article from it.

## Article rules
- The article title is a real question people search, phrased naturally. Examples: "How much should a landscaper charge per hour?", "Is it worth refinancing a mortgage right now?", "What do you need to start a podcast?" Aim for questions with search demand and a clear answer in the episode.
- 600-900 words. Humanized: short direct sentences, contractions, no stiff constructions. No em dashes anywhere (use commas or periods). Never use "why this matters" or "why X matters". Headings must not restate the point literally; make them specific.
- Structure: `intro` (2-3 sentences that answer the question directly up front, mentioning the podcast and host by name), 3-5 `sections` each with a heading, markdown body, and an optional verified quote, `keyTakeaways` (3-5 bullets), `faq` (3 real follow-up questions with 1-3 sentence answers), `sourceNote` (one sentence: which episode, when it aired, credit to the show).
- Do not recommend competitors, other podcasts, or tell readers to go elsewhere. The podcast being featured is the expert.

## Output
Write one JSON file per podcast to `/home/claude/podanswer/data/seed/podcasts/<slug>.json` (slug = lowercase, hyphens, from the podcast title). Schema:

```json
{
  "slug": "the-landscaping-podcast",
  "title": "The Landscaping Podcast",
  "author": "Jane Doe",
  "description": "1-3 sentence description from the feed",
  "category": "one of: business, marketing, money, real-estate, law, health, fitness, science, history, technology, productivity, parenting, home, food, careers, education, psychology, creative",
  "website": "https://...",
  "feedUrl": "https://...",
  "imageUrl": "https://...",
  "appleUrl": "https://podcasts.apple.com/...",
  "spotifyUrl": "",
  "episodes": [
    {
      "guid": "...",
      "title": "...",
      "publishedAt": "2026-08-01",
      "summary": "2-3 sentences",
      "audioUrl": "https://...",
      "durationSec": 2400,
      "episodeUrl": "https://...",
      "transcriptUrl": ""
    }
  ],
  "articles": [
    {
      "slug": "how-much-should-a-landscaper-charge-per-hour",
      "question": "How much should a landscaper charge per hour?",
      "metaDescription": "under 155 chars",
      "episodeGuid": "guid of the episode used",
      "intro": "…",
      "sections": [
        { "heading": "…", "body": "markdown…", "quote": { "text": "…", "speaker": "Jane Doe", "timestamp": "12:40" } },
        { "heading": "…", "body": "markdown…", "quote": null }
      ],
      "keyTakeaways": ["…"],
      "faq": [ { "q": "…", "a": "…" } ],
      "sourceNote": "…"
    }
  ]
}
```

Validate each file parses as JSON before moving on (`node -e "JSON.parse(require('fs').readFileSync('file'))"`). When done, reply with a list of slugs written and any podcasts you skipped and why.
