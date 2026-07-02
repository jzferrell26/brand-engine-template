---
name: client-brand-engine-intake-chat
description: Conversational-only client intake for the Client Brand Engine, for use in Claude Chat (claude.ai Projects) rather than Claude Code. Runs the brand interview and drafts BRAND-GUIDE.md, brand-voice-pack.md, and brand-config.json content for a human to paste into the client's repo. Does not scaffold repos, run code, or call GHL -- see the client-brand-engine-intake skill (Claude Code) for that.
---

# Client Brand Engine: client intake (Claude Chat edition)

This is the claude.ai-Project-compatible variant of `client-brand-engine-intake`. It exists because not everyone on the team works from Claude Code / a terminal -- this version runs the same intake interview and produces the same three brand-pack documents, as text you paste into files yourself (or hand to a teammate in Claude Code to commit).

## What this skill can and cannot do

**Can:**
- Run the full intake interview (identity, voice, audience, signature content, visual identity, compliance fields).
- Draft the content of `BRAND-GUIDE.md`, `brand-voice-pack.md`, and `brand-config.json` from the interview answers, matching the template shapes below.
- Sanity-check draft copy against the brand voice once you've described it (e.g. "does this email sound like the client?").
- Design/refine `namedFrameworks` fidelity rules and `bannedPhrases` entries.

**Cannot (Claude Chat has no filesystem, git, or outbound API access):**
- Create the GitHub repo or clone the template.
- Write files directly into the client's repo -- you'll get the content as a message; someone with Claude Code (or a text editor + git) has to save it into `BRAND-GUIDE.md`, `brand-voice-pack.md`, and `src/config/brand-config.json` and commit it.
- Run `npm run ci`, generate a real content package, or dry-run GHL delivery.
- Touch the client's GHL account in any way.

If the person running this conversation doesn't have someone available to do the Claude-Code half, tell them so up front -- this skill gets them 80% of the way (a complete, reviewed brand pack) but someone still has to land it in the repo and run the verification pass.

## 1. Run the intake interview

Ask these questions one section at a time (don't dump all of them at once -- this works better as a real conversation, especially for the voice/signature-content section where follow-up questions matter):

**Identity & voice**
- Client/brand name, as it should appear in emails and signoffs.
- Who are they, in 2-3 sentences (role, credentials, what they're known for)?
- Core promise: the one-sentence transformation they sell.
- One voice or several registers? If several: where's each used, what must never bleed into the other?

**Audience**
- Every distinct audience segment, described in the client's own language.

**Signature content**
- Their repeatable content pattern, if they have one (ask for 2-3 real examples of their best-performing content and reverse-engineer the shape together if they can't articulate it directly).
- Named frameworks/systems they teach, and the exact required parts of each.
- Banned phrases + required replacements.
- Exact signoff text.

**Visual**
- Palette (background / primary / accent / secondary / emphasis hex codes), heading font, body font, logo URL + alt text, default CTA label.

**Compliance**
- Physical mailing address, From name + address, Reply-To, sending domain.

**GHL**
- Do NOT ask for the Private Integration Token in this conversation -- Claude Chat conversations are not the right channel for a live secret. Just confirm the client has a location ID and PIT ready; tell the operator those get set as repo secrets when someone runs the Claude Code half.

## 2. Draft the three documents

Once you have real answers (not placeholders), produce three clearly-labeled blocks the operator can copy:

1. **`BRAND-GUIDE.md`** -- follow the section structure in this template repo's `BRAND-GUIDE.template.md` (who they are, audience, voice/registers, tone do/don't, messaging pillars, signature language, proof, visual identity, email block order, compliance, pre-publish checklist).
2. **`brand-voice-pack.md`** -- follow `brand-voice-pack.template.md`'s field structure (client, one_liner, voice, registers, signature_devices, do, dont, offers, assets, design_system, proven_sequences, compliance). Keep it consistent with the BRAND-GUIDE content -- don't contradict it.
3. **`brand-config.json`** -- valid JSON matching this shape (see `src/config/brand-config.ts` in the template repo for the authoritative schema; ask the operator to paste it into this conversation if you need to double check a field):

```json
{
  "brandName": "...",
  "registers": [{ "name": "...", "label": "...", "voiceInstructions": "...", "markers": ["..."], "domainPatterns": ["..."] }],
  "hardRules": ["..."],
  "contentPattern": ["..."],
  "emailBlockOrder": ["..."],
  "namedFrameworks": [{ "name": "...", "requiredSlots": [["..."]], "minSlotsMatched": 1 }],
  "bannedPhrases": [{ "phrase": "...", "replacement": "..." }],
  "confirmedMergeTokens": ["{{contact.first_name}}"],
  "fromIdentity": { "name": "...", "address": "...", "replyTo": "..." },
  "signoffName": "...",
  "emailDesignSystem": {
    "palette": { "background": "#...", "primary": "#...", "accent": "#...", "secondary": "#...", "emphasis": "#..." },
    "headingFont": "...",
    "bodyFont": "...",
    "logoUrl": "...",
    "logoAlt": "...",
    "defaultCtaLabel": "...",
    "footerNote": "..."
  }
}
```

Mark anything you don't have a real answer for as `TODO` rather than inventing it -- the engine's preflight linter will refuse to ship a live email until the compliance TODOs are resolved, and inventing brand facts defeats the entire point of the intake.

## 3. Hand off

Tell the operator explicitly: "This is the brand pack. Someone needs to run the `client-brand-engine-intake` skill in Claude Code (or manually) to: create the client repo from the template, save these three files in, install dependencies, run `npm run ci`, generate a test piece, and dry-run delivery before anything goes live." Don't imply the client is ready to send anything -- it isn't, until that verification pass happens.
