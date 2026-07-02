---
name: client-brand-engine-intake
description: Repeatable process for onboarding a new client onto the Client Brand Engine (approval-gated GHL content generation). Use when standing up a new client repo from this template, filling in their brand pack, wiring GHL credentials, and getting to a verified dry-run. Covers the intake interview, repo instantiation, secrets, dry-run verification, and the optional scheduled-autonomy handoff.
---

# Client Brand Engine: client intake

This is the process the team runs for every new client. It turns a blank template clone into a working, dry-run-verified brand engine for that client, without touching `src/`. If you find yourself editing engine code (`src/**/*.ts`) to make a client "fit," stop -- that means the engine's brand-config schema (`src/config/brand-config.ts`) is missing a knob, and that's a template change, not a per-client change.

## 0. Before you start

Confirm you have, or can get:
- The client's brand materials (existing brand guide, voice/tone doc, sample emails or posts, logo, color palette) -- whatever they already have. If they have nothing written down, budget time for the interview in step 2 to extract it.
- Their GoHighLevel **location ID** and a **Private Integration Token (PIT)** scoped to that location (`socialplanner/account.readonly`, `socialplanner/post.write`, plus email template write access). Get this from the client or whoever manages their GHL account -- never from a shared/parent agency PIT.
- Their physical mailing address (CAN-SPAM requires this in every email footer; the engine will refuse to push live email without it).
- Confirmation of From name, From address, and Reply-To address for their sends.

## 1. Instantiate the client repo

1. Create a new GitHub repo for this client (the operator does this, not the agent -- e.g. `Cuantico-AI/<client-slug>-brand-engine`).
2. Clone this template repo's contents into it (or use GitHub's "template repository" feature if this repo is marked as one).
3. Confirm `.claude/skills/client-brand-engine-intake/` came along -- this skill should be available in Claude Code from inside the new client repo without any extra setup.

## 2. Run the intake interview

Ask the operator (or the client directly) these questions. Don't skip ahead to writing files until you have real answers -- the engine's "no invented facts" rule in `src/preflight/index.ts` exists precisely because half-remembered brand facts are worse than a `TODO`.

**Identity & voice**
- What's the client's name / brand name (as it should appear in emails, footers, signoffs)?
- Who are they, in 2-3 sentences? (role, credentials, what they're known for)
- What's their core promise -- the one-sentence transformation they sell?
- Do they have one voice, or more than one register (e.g. a polished main-brand voice vs. a rawer community-brand voice)? If more than one: where is each used, and what must never bleed into the other?

**Audience**
- Who are they talking to? List each distinct segment.

**Signature content**
- Do they have a repeatable pattern their best content follows (an opening hook, a "reframe" moment, a signature phrase)? Ask for 2-3 real examples if they have them.
- Do they have any named frameworks (a "system" or "method" they teach, with specific required parts)? For each: what are the required parts, and does mentioning the framework without all its parts constitute a factual error worth blocking on?
- Any banned phrases and their required replacements (e.g. "don't call it X, call it Y")?
- Exact signoff text?

**Visual**
- Color palette (5 roles: background, primary, accent, secondary, emphasis -- hex codes)
- Heading font + body font
- Logo URL + alt text
- Default CTA button label

**Compliance (blocks live email until answered)**
- Physical mailing address
- From name + From address
- Reply-To address
- Sending domain (confirm SPF/DKIM/DMARC is the operator's responsibility or the client's)

**GHL**
- Location ID
- Private Integration Token (get this via a secure channel, never pasted into chat history you don't control)

## 3. Write the brand pack

Three files, none of which are checked into the *template* repo but all of which belong in the *client's* repo:

1. Copy `BRAND-GUIDE.template.md` -> `BRAND-GUIDE.md`. Fill in every section from the interview. This is the narrative document a human writer would read.
2. Copy `brand-voice-pack.template.md` -> `brand-voice-pack.md`. Fill in every field; keep it consistent with `BRAND-GUIDE.md`. Any field you don't have an answer for yet stays marked `> TODO: open question - needs human decision` -- do not guess.
3. Copy `src/config/brand-config.example.json` -> `src/config/brand-config.json`. This is the one the engine code actually reads. Translate the interview answers into the schema (`src/config/brand-config.ts` is the source of truth for field meanings):
   - One entry in `registers[]` per voice, with `markers` and `domainPatterns` that are genuinely exclusive to that register (used for the cross-register contamination check).
   - `namedFrameworks[]` only for frameworks where partial-mention is a real factual error worth blocking generation over. Not every named thing needs an entry.
   - `fromIdentity`, `signoffName`, `emailDesignSystem` straight from the interview.
   - Leave `bannedPhrases[]` empty if there aren't any yet; add as they come up.

## 4. Verify before touching GHL

```
npm install
npm run ci
```

This runs typecheck, the test suite, and the duplication check. If `brand-config.json` is malformed, `npm run test` will fail loudly with the exact validation error (see `loadBrandConfig` in `src/config/brand-config.ts`) -- fix the JSON, don't work around it.

Then generate a real piece against the brand pack to sanity-check the voice:

```
ANTHROPIC_API_KEY=sk-... node --import tsx/esm src/agent/cli.ts --brief brief.json --out output.json
```

Where `brief.json` is a minimal `Brief` (see `src/types.ts BriefSchema`):
```json
{ "event": "Test campaign", "theme": "Intro", "register": "<one of your registers[].name>", "channel": "email", "count": 1 }
```

Read the output. Does it sound like the client? Does preflight pass? If preflight fails, the violations tell you exactly what's wrong (unconfirmed merge token, missing framework component, banned phrase, etc.) -- fix the brand pack or the brief, not the engine.

## 5. Dry-run delivery

Never push live on the first pass. Dry-run both channels first:

```
GHL_LOCATION_ID=<client's location id> node --import tsx/esm src/delivery/social/cli.ts --dry-run
GHL_LOCATION_ID=<client's location id> PHYSICAL_ADDRESS="<address>" node --import tsx/esm src/email/cli.ts --dry-run
```

Dry-run prints the exact payloads without calling the GHL API. Confirm the rendered HTML looks right (open the printed preview, or render a piece to a file and open it in a browser) and the social payloads target the right accounts.

## 6. Go live

Set `GHL_PIT` (this client's token, never a shared one) as a repo secret (not committed, not in `.env` checked into git -- see `.gitignore`). Re-run the same commands without `--dry-run` / with `--push`. The engine only ever creates GHL drafts -- the client still has to approve and schedule/send from the GHL UI. That's the safety net; trust it, don't route around it.

## 7. Optional: scheduled autonomy loop

Only after the manual flow above has been run successfully at least once for this client. See `library/knowledge/private/brand-engine/architecture-overview.md` section 7 for the pattern (weekly GitHub Actions run, versioned campaign calendar, idempotent state ledger, Slack notification on every run). This is opt-in per client, not part of the base template.

## Anti-patterns to avoid

- **Editing `src/` to special-case a client.** If the brand-config schema can't express what this client needs, that's a schema gap -- fix `src/config/brand-config.ts` in the *template* repo (so every future client benefits), don't hack the client repo's copy of the engine.
- **Skipping the interview and guessing brand facts.** The preflight linter's entire job is catching invented facts; don't make it fight against a `brand-voice-pack.md` that was itself invented.
- **Reusing another client's GHL PIT or location ID.** Every client has their own; there is no "default" location any more (the original single-client build had one hardcoded -- this template deliberately does not).
- **Pushing live before a dry-run.** The dry-run flags exist on every delivery CLI specifically so this never has to be a leap of faith.
