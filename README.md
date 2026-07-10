# Brand Engine Template

Canonical source: [`Cuantico-AI/brand-engine-template`](https://github.com/Cuantico-AI/brand-engine-template). This is the one repo to clone/instantiate from for every new client -- do not fork a client's own repo to start the next one, since client repos accumulate that client's brand pack and campaign history.

An approval-gated content engine: campaign brief -> LLM generation -> brand-fidelity preflight linter -> GoHighLevel delivery, as drafts only. **The engine never publishes** -- every email and social post lands in the client's GHL approval queue for them to review and send.

This repo is a **template**, not a client. It contains the reusable engine (`src/`) and ships with fictitious example brand content. Every real client gets their own repo instantiated from this template, with their own brand pack and their own GHL credentials. [`Cuantico-AI/momentum-builder`](https://github.com/Cuantico-AI/momentum-builder) is the first client instantiated from it.

Originally extracted from a single-client build (Heather Ferrari's brand engine); genericized so a new client never means editing `src/`.

## For the Notorious Avengers

Shared with the Notorious Avengers Group, my crew of dev friends. Take it, run it, break it, make it yours. Clone it or hit "Use this template" to spin up your own copy, then build your own client engines on top. Everything shipped here is fictitious example content, so there is nothing to scrub before you start. Ping me if anything is unclear.

## The split: engine vs. brand pack

| | Lives in | Per-client? |
|---|---|---|
| Generation pipeline, preflight linter, GHL delivery clients, runway calculator | `src/**/*.ts` | No -- shared engine |
| Register voice, hard rules, named frameworks, email design system, from-identity | `src/config/brand-config.json` | **Yes** |
| Brand narrative, signature lines, proof points | `BRAND-GUIDE.md`, `brand-voice-pack.md` | **Yes** |
| GHL credentials | `GHL_PIT` / `GHL_LOCATION_ID` env vars | **Yes** |

See `library/knowledge/private/brand-engine/architecture-overview.md` for the full architecture.

## Quickstart for a new client

1. Read `.claude/skills/client-brand-engine-intake/SKILL.md` -- it's the repeatable onboarding process (intake interview, repo setup, secrets, dry-run, handoff).
2. Copy `src/config/brand-config.example.json` -> `src/config/brand-config.json` and fill it in.
3. Copy `BRAND-GUIDE.template.md` -> `BRAND-GUIDE.md` and `brand-voice-pack.template.md` -> `brand-voice-pack.md`; fill both in.
4. `npm install`
5. `npm run ci` (typecheck + tests + duplication check) to confirm the engine and brand pack are wired correctly.
6. Dry-run a brief:
   ```
   ANTHROPIC_API_KEY=sk-... node --import tsx/esm src/agent/cli.ts --brief brief.json --out output.json
   ```
7. Dry-run delivery (no live GHL calls):
   ```
   GHL_LOCATION_ID=xxx node --import tsx/esm src/delivery/social/cli.ts --dry-run
   GHL_LOCATION_ID=xxx node --import tsx/esm src/email/cli.ts --dry-run
   ```
8. Once trusted, push for real with `GHL_PIT` set and the `--push` / (no `--dry-run`) flags.

## Commands

```
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run dup         # jscpd duplication check
npm run ci           # all three
```

## Repo layout

```
src/
  types.ts              # Brief / ContentPiece / ContentPackage schemas (brand-agnostic)
  config/
    brand-config.ts      # BrandConfigSchema + loader (fails loud if missing)
    brand-config.example.json
  agent/                 # brief -> LLM generation, config-driven prompts
  preflight/              # brand-fidelity linter, config-driven
  delivery/social/        # GHL Social Planner client + draft-only delivery
  email/                  # GHL v3 template render + push
  launch/                  # multi-day campaign runway calculator + launch-kit orchestration
library/                  # PRDs, QA reports, knowledge docs (library-guardian convention)
.claude/skills/
  client-brand-engine-intake/   # the repeatable onboarding skill (Claude Code)
  client-brand-engine-intake-chat/  # portable variant for claude.ai Projects
BRAND-GUIDE.template.md   # copy to BRAND-GUIDE.md per client
brand-voice-pack.template.md  # copy to brand-voice-pack.md per client
```

## What never ships in this template

`BRAND-GUIDE.md`, `brand-voice-pack.md`, and `src/config/brand-config.json` are gitignored in this template repo on purpose -- they're the client's actual brand content and belong only in that client's instantiated repo, never in the shared template.
