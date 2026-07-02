# [Client Name]: Brand Source of Truth

The single reference for anyone creating content for [Client Name]: emails, social posts, landing pages, ads, scripts, captions, anything. If you are writing as [Client Name] or for them, read this first. When in doubt, this document wins.

> How to use it: skim sections 1-5 before you write a word (who they are and how they sound). Pull section 6 for their actual phrases and frameworks. Use sections 7-11 for the visual and channel rules. Run the section 12 checklist before anything ships.
>
> This is a fill-in-the-blank scaffold. Delete this blockquote and every `[bracketed]` placeholder once filled in. Everything you write here gets injected verbatim into every generation prompt (see `src/agent/index.ts`) -- write it the way you'd brief a new copywriter on day one, not as marketing copy about the brand.

---

## 1. Who [Client Name] is

[2-3 sentences: their role/title, years of experience, credentials, what they're known for. Reference their book/course/signature offer if any.]

Their core promise: **[one sentence -- the transformation they sell].**

The one idea under everything they say: **[the single reframe/insight that recurs across all their content].**

## 2. Who we are talking to

[List each audience segment as its own bullet. These become the free-text `audience` values used in campaign briefs -- they don't need to match any fixed list.]

- **[Segment 1]:** [who they are, what they're struggling with]
- **[Segment 2]:** [who they are, what they're struggling with]

## 3. The voice(s) / register(s)

[If there's only one voice, say so and skip the "registers" framing entirely. If there are multiple (e.g. a polished main-brand voice vs. a rawer community-brand voice), describe each one here -- these map 1:1 to the `registers[]` array in `src/config/brand-config.json`.]

### [Register 1 name] (default)
- **Where:** [domains/channels this voice is used on]
- **Feel:** [3-5 adjectives]
- **Use for:** [when to use it]

### [Register 2 name, if any]
- **Where:**
- **Feel:**
- **Use for:**
- **Never let it bleed into [Register 1]:** [explicit boundary rule]

## 4. Voice and tone (how they sound)

[Describe their signature content pattern -- the repeatable shape their best emails/posts follow. This becomes `contentPattern[]` in brand-config.json. Example shape (Heather Ferrari's "truth bomb"):
1. Open with a scenario or rhetorical question the reader recognizes
2. A pivot line
3. The reframe itself, as a punchy standalone line
4. Name the framework/fix
5. One clear next step
6. Sign off in first person
7. Reinforce with a P.S.]

Tone traits:
- [trait]
- [trait]

### Do
- [specific, concrete guidance]

### Do not
- [specific, concrete guidance -- these become `hardRules[]` in brand-config.json]
- **No em dashes. Ever.** (the engine hard-scans for this regardless of what you write here -- keep it in the guide anyway so a human writer knows the rule too)

## 5. Messaging pillars (what they are always saying)

1. [pillar]
2. [pillar]

## 6. Signature language (their actual words)

### Named frameworks
[Each framework you list here that has a specific required structure (e.g. "3 gaps" or "4 hiding places") should also get an entry in `namedFrameworks[]` in brand-config.json, so preflight can verify the LLM didn't half-remember it.]

- **[Framework name]:** [what it means, its required components]

### Lines to reuse verbatim
- "[signature line]"
- "[signature line]"

### Phrasing rules
- [banned phrase] -> use "[replacement]" instead (add to `bannedPhrases[]` in brand-config.json)
- Sign-off is "[exact signoff text]"

## 7. Proof and credibility

- [credential/stat -- only include things that are TRUE and confirmed; the engine flags unconfirmed numeric claims as warnings]

## 8. Visual identity

### Color palette
| Role | Hex | Use |
|---|---|---|
| Background | `#______` | Page and block backgrounds |
| Primary | `#______` | Hero, headers, primary text |
| Accent | `#______` | Buttons, pull-quote blocks |
| Secondary | `#______` | Secondary text on dark, accents |
| Emphasis | `#______` | Italic emphasis, the "truth block" accent |

[These map directly to `emailDesignSystem.palette` in brand-config.json.]

### Typography
- **[Heading font]:** headlines and emphasis.
- **[Body font]:** body, labels, buttons.

## 9. Logo

- URL: [hosted logo URL]
- Alt text: [client name]

## 10. Email block structure

[List the required block order for this client's emails -- maps to `emailBlockOrder[]` in brand-config.json. Heather's shape: header -> hero (eyebrow + headline + sub) -> body -> emphasis block -> pull-quote -> CTA -> signoff -> P.S. -> footer.]

## 11. Compliance

- Physical mailing address: [fill in before any live send]
- From name / From address: [fill in]
- Reply-To: [fill in]
- Sending domain / SPF-DKIM-DMARC: [confirm with operator]

## 12. Pre-publish checklist

- [ ] No em dashes
- [ ] Register is pure (no mixing)
- [ ] Named frameworks mentioned completely, not partially
- [ ] No invented stats/names/offers
- [ ] CAN-SPAM footer present (email only)
- [ ] Signoff matches section 6
