---
title: Why is my podcast not showing up on Spotify?
description: Why is my podcast not showing up on Spotify? Work through feed errors, submission status, artwork rules, caching delays and the Apple equivalent.
date: 2026-09-18
slug: why-is-my-podcast-not-showing-up-on-spotify
---

Spotify's podcast intake is almost entirely automated, which means a show that fails to appear has failed a machine check rather than a human one. That is good news. Machine failures have specific causes, and six of them account for nearly every case: an RSS feed Spotify will not accept, a submission that never completed, artwork or metadata that broke a requirement, an episode-level tag blocking a single episode, the normal processing window, or a show that is live and findable while you search for it the wrong way.

Work through them in that order. A broken feed makes every later check meaningless.

## When a podcast is not showing up on Spotify, start with the feed

Your RSS feed is the only thing Spotify sees. If the feed is malformed, nothing else you do will help. Open your feed URL in a browser first. If you get a 404, a login prompt, or a blank page, that's your answer, and your host's dashboard is where you fix it.

Then run the feed through a validator. Most hosts have one built in, and there are free public ones. What trips people up most often:

- **The feed isn't publicly reachable.** Private feeds, or feeds behind bot-blocking rules, fail silently.
- **No enclosure tag on episodes.** Every episode needs a direct link to a playable audio file. A redirect chain that ends in a 403 won't process.
- **Broken characters.** Stray ampersands and unescaped HTML in a title can break the XML, and one bad character in one episode breaks the whole file.
- **Missing required elements.** Title, description, language, and a valid category are not optional.
- **HTTP instead of HTTPS.** Both the feed and the audio files should be served over HTTPS.

Shows on a mainstream host such as Buzzsprout, Transistor or Libsyn rarely have feed problems, because the host generates valid XML for you and the failure is further down this list. Hand-built feeds fail here, and they fail here often.

## Check whether you actually submitted it

The most common cause of a podcast not showing up on Spotify is also the least interesting one. Uploading episodes to your host does not put you on Spotify. Someone has to hand Spotify the feed URL, and plenty of producers assume their host did it.

Log in to Spotify for Creators and look at your show's status. If the show doesn't appear at all, the submission never went through. If it says pending or processing, you're in the queue. If it says rejected, the reason is usually stated right there, and it's normally a metadata problem.

One wrinkle is worth an extra minute of your time. Some hosts push to Spotify automatically once you flip a toggle in their distribution settings, so a manual submission on top of that produces a duplicate or a stalled entry. Check your host's distribution page before you resubmit anything.

## How long does it take for a podcast to appear on Spotify?

A few hours to a couple of days is the working range for a new show. Approvals often land within hours, but 48 hours is the point at which it becomes reasonable to assume something has gone wrong. New episodes on an already-approved show move faster, usually within an hour or two of your host publishing them.

The delay that feels longest is the one where the show is already live and search has not caught up. Spotify's index and its catalog are separate systems, so a show can be playable at its direct URL and still be absent from search results for a day after approval.

## The rules that reject shows without explanation

Spotify and Apple both enforce hard requirements that first-time podcasters miss regularly. These are the ones that cause rejections:

| Common cause | What's actually wrong | How to fix it |
|---|---|---|
| Artwork rejected | Below 1400x1400 pixels, above 3000x3000, not square, or not JPEG/PNG | Export a square 3000x3000 JPEG under 512KB and republish the feed |
| Artwork has a URL or promo text | Platforms reject cover art that looks like an ad | Remove web addresses, "new episode" banners, and pricing from the image |
| No episodes in the feed | Both platforms need at least one published episode to review | Publish a real episode, not a trailer placeholder, then submit |
| Explicit tag missing | The feed has no explicit yes/no value at show level | Set it in your host's settings, even if the answer is no |
| Explicit mismatch | An episode is marked clean but contains flagged language | Mark the individual episode explicit rather than the whole show |
| Duplicate submission | The same feed submitted twice, or a migrated feed still live at the old URL | Remove or 301 redirect the old feed, contact support to merge |
| Category invalid | A custom category string your host allowed but the spec doesn't include | Pick from the standard Apple category list |
| Audio file too large | Files over roughly 200MB can fail to process | Export at 96kbps mono for talk shows |

Artwork catches more shows than the other seven rows combined. A production that cost you forty hours can sit in limbo because the cover art is 1200 pixels wide.

## When one episode is missing but the show is fine

A podcast episode not showing up is a different problem from a missing show, and it has its own short list of causes.

Check the publish date first. If it's in the future, even by a few hours because of a timezone mismatch, apps hold the episode until that time passes. If a typo put it in 2019, the episode appears but sits buried at the bottom of your list.

Then check the audio file. Download it from the URL in your feed, and if it doesn't play in a browser it won't play in Spotify. Episodes still uploading when the feed refreshed often show as missing. Finally, look for a per-episode block setting, which most hosts have and which is easy to leave on by accident.

## Why your podcast is not showing up on Apple Podcasts either

Apple runs the same process more slowly and with less tolerance. You submit through Apple Podcasts Connect, review typically takes a few days rather than a few hours, and Apple is noticeably fussier about artwork dimensions, about a real episode being live at submission time, and about descriptions that read like ad copy.

Two Apple-specific details are worth knowing. Apple caches feeds aggressively, so a fix can take up to 24 hours to appear unless you ping the feed from inside Podcasts Connect. And if you changed hosts, Apple follows the `new-feed-url` tag in your old feed, which needs to stay live for a couple of weeks. Deleting it early is how shows lose their subscribers and their reviews.

## Approved, live, and still not showing up on Spotify

Most people who ask this question land here. The show is live, the feed is clean, and searching your own title returns somebody else's podcast.

Search the exact show title in quotes first, then the host's name. If neither works, the index hasn't caught up, and that resolves on its own. Clearing the app cache or signing out and back in helps more often than it should.

The harder version of this problem is a title that competes with a common phrase. A show called "The Daily Grind" loses to bigger shows and to Spotify's music catalog permanently, and no support ticket changes that. The only fix is generating enough searches for your actual name that the algorithm learns it, a slow process covered in more detail in our guide to [getting more podcast listeners on Spotify](/blog/how-to-get-more-podcast-listeners-on-spotify).

## Common questions

### Can I resubmit my feed while a submission is pending?

You can, but don't. Duplicates create two show entries that support has to merge, which takes longer than waiting. If you're past 48 hours with no movement, contact Spotify support with your feed URL instead of starting over.

### Do I need to resubmit after fixing my feed?

No. Once your show is accepted, Spotify re-checks the feed and picks up changes on its own, usually within a few hours. Most hosts also have a "refresh feed" button that pings the platforms directly.

### Will deleting and re-uploading an episode fix a missing episode?

Sometimes, but it costs you the episode's GUID, which is how apps track what people have heard. A new GUID can resurface the episode as unplayed and break existing links. Fix the file or the date first, and treat re-uploading as a last resort.

## Being listed is a floor, not a strategy

Distribution solves one problem: a person who already knows your show can now play it. Solving it puts you among several million shows inside a search box that most people only use to type names they have already heard. The listeners who have never heard of you are in Google, typing the questions your episodes already answer.

A disclosure, since that gap is the business I work in. PodAnswer takes your feed, transcribes it, finds the questions people search in your subject, and publishes the moments in your episodes that answer them as articles with timestamped quotes and links back to your show. Listing a podcast is [free](/for-podcasters), and the paid packages sit on the [pricing page](/pricing) for shows that want a set number of answers published each month. If directory listings are the whole of your marketing so far, [this walkthrough on promoting a podcast](/blog/how-to-promote-a-podcast) is a reasonable next read.
