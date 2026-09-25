# Brief: rewrite the voice of a PodAnswer blog article

You are rewriting existing articles so they read like a Forbes contributor piece written by an industry operator, not like an AI assistant. The substance is already right. You are changing how it sounds, not what it says.

## Preserve exactly, do not touch
- The frontmatter block (title, description, date, slug), unchanged.
- Every `##` and `###` heading's position and meaning. You may sharpen heading wording, but keep the same number of sections in the same order.
- Every markdown link and its URL. Anchor text can change, the URL cannot. Do not add or remove links.
- Every markdown table, its rows and its numbers.
- The `## Common questions` FAQ section with its three `###` questions.
- Body length: stay within 1,400 to 1,650 words.
- All factual claims, numbers and price bands.

## Voice target: Forbes contributor, operator byline
- Open cold on a specific, concrete observation. A number, a scene, a piece of market reality, or a blunt claim. Never open with a question, never with "If you have ever", never with a definition.
- Write with authority and economy. Declarative sentences. Active voice. The reader is a professional, not a student.
- Vary sentence length deliberately. A long sentence carrying a real idea, then a short one that lands it. Never three short fragments in a row.
- Paragraphs of two to four sentences. Break them where a human would breathe.
- Prefer concrete nouns and real numbers over adjectives. "A show doing 400 downloads an episode" beats "a small show".
- Attribute general claims the way a journalist does: "Hosting platforms that publish benchmarks put...", "Ask any producer and...", "The pattern across the shows we work with is...". Never invent a named study, a named person, or a precise statistic.
- Business framing is welcome: cost, margin, opportunity cost, what an hour is worth, what a customer is worth.
- Address the reader as "you" where it is natural, but do not coach, cheerlead or reassure.

## Banned, remove every instance
Words and phrases: quietly, landscape, realm, delve, dive in, deep dive, unlock, leverage (as a verb), robust, seamless, testament, tapestry, beacon, crucial, pivotal, vital, moreover, furthermore, additionally, in conclusion, ultimately, it's worth noting, when it comes to, that said, here's the thing, the truth is, at the end of the day, navigate the, game changer, supercharge, elevate, empower, harness, myriad, plethora, in today's, ever-evolving, fast-paced, double-edged sword, no-brainer, needle-moving, secret sauce, hidden gem.

Constructions:
- "It's not just X, it's Y" and every variant of that reversal.
- "X isn't about Y. It's about Z."
- Three-item lists used for rhythm rather than content ("Faster, cheaper, better.")
- Rhetorical questions used as transitions.
- Sentence fragments used for emphasis. Write full sentences.
- Starting consecutive paragraphs with the same word.
- Em dashes. Use commas, periods or parentheses.
- Any "why X matters" construction, as a heading or in body copy.
- Summary sentences that restate the paragraph you just wrote.
- Hedging stacks: "generally speaking, it's often the case that".

## Also keep
- No recommending a competing promotion service, agency or directory. Naming Apple, Spotify, YouTube or hosting platforms factually is fine.
- The short closing tie-in to PodAnswer stays, but make it read like a disclosure a contributor would write, not a pitch.

## After rewriting each file, verify
```
awk 'BEGIN{n=0} /^---$/{n++; next} n>=2{print}' FILE | wc -w      # 1400-1650
grep -c '—' FILE                                                   # must be 0
grep -oiE "quietly|landscape|delve|unlock|leverag|robust|seamless|crucial|pivotal|moreover|furthermore|in conclusion|ultimately|when it comes to|that said|the truth is|isn'?t just|not just" FILE   # must be empty
grep -o '](/[a-z/-]*)' FILE                                        # same URLs as before you started
```
Report the word count and confirm the link list is unchanged.
