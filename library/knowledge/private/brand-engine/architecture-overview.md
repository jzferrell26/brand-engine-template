# Client Brand Engine: Architecture Overview

> Category: Architecture | Version: 1.0 | Date: 2026 | Status: Active

The Client Brand Engine is an approval-gated, semi-autonomous content system. An operator gives it a brief; it generates voice-faithful content packaged for the client's approval queue. Nothing publishes without their sign-off. This document describes the engine generically -- see `BRAND-GUIDE.md`, `brand-voice-pack.md`, and `src/config/brand-config.json` for this client's specific brand pack.

**Related:**
- [Brand Source of Truth](../../../../BRAND-GUIDE.md)
- [Machine-readable Voice Pack](../../../../brand-voice-pack.md)
- [Brand Config Schema](../../../../src/config/brand-config.ts)

---

## 1. The golden constraint

**The client approves everything. The engine never publishes.**

GHL Social Planner has a native approval flow: posts wait in Content > Approval and the client is emailed; nothing goes live until they act. Email campaigns are delivered as GHL draft templates they review and send from the UI. Every output artifact produced by this engine is routed to one of these two approval gates before anything reaches an audience.

---

## 2. System components

### 2a. The Brain (brand source of truth + voice pack + brand config)

The three authoritative files every generation pass loads:

| File | Role |
|---|---|
| `BRAND-GUIDE.md` (repo root) | The canonical brand source of truth: who the client is, their register(s), signature devices, named frameworks, hard rules, the email block structure, the pre-publish checklist. |
| `brand-voice-pack.md` (repo root) | Machine-readable distillation: voice description, registers, signature devices, do/dont rules, assets catalog, compliance TODO block, proven sequence shape. |
| `src/config/brand-config.json` (repo root, gitignored) | Structured config the engine code reads directly: register definitions, named-framework fidelity rules, banned phrases, from-identity, signoff, email design system. See `src/config/brand-config.ts` for the schema. |

These files are never duplicated inside `src/`. All content generation references them. They are the brain, and they are the only thing that changes between clients.

### 2b. The Preflight (safety spine)

Before any content leaves the generator, an automated preflight check runs (`src/preflight/index.ts`), driven entirely by `brand-config.json`:

- Zero em dashes (hard-scan every character)
- Register purity: a piece generated for one register must not contain another declared register's markers or domain/CTA patterns
- Banned phrases (from `brand-config.bannedPhrases`), each with a suggested replacement
- No disallowed merge tokens beyond `{{contact.first_name}}`, `{{email.unsubscribe_link}}`, and anything else in `brand-config.confirmedMergeTokens`
- Email-specific: CAN-SPAM physical address placeholder present, unsubscribe link token present, From/Reply-To fields set
- Named-framework fidelity: any mention of a framework in `brand-config.namedFrameworks` must also mention enough of its required components (configurable per framework -- "all N of N" or "at least N of M")
- No invented facts: no client names, stats, or offers beyond those recorded in the voice pack (numeric claims are flagged as warnings for human verification)

A preflight failure blocks the content package from delivery. The operator sees a diff-style error list and must approve or regenerate.

### 2c. The Generator (content in the client's voice)

Invoked with a campaign brief (`src/types.ts BriefSchema`):

```
event:       string        (webinar name, framework name, or campaign theme)
theme:       string        (which pillar/topic)
audience:    string        (free-text audience description)
register:    string        (must match a register name in brand-config.json)
channel:     email | social | both
count:       number        (how many pieces to generate)
platforms:   string[]      (social platforms to round-robin; default linkedin/facebook)
```

The generator (`src/agent/index.ts`) uses the brain files as grounding, pulls this register's voice instructions + the brand's hard rules + content pattern + email block order from `brand-config.json`, and produces a content package conforming to the output contract:

```
ContentPackage
  briefSummary:   string
  register:       string
  channel:        email | social | both
  pieces[]:
    id:           string
    type:         email | social-post
    platform:     string
    subject?:     string          (email only)
    body:         string
    scheduleHint: ISO 8601 UTC    (suggested; operator re-schedules at approval)
    imageDirectionHint?: string
  preflightResult:
    passed:       boolean
    violations[]: string[]
```

The generator does NOT publish. It produces the package and runs the preflight.

### 2d. The Delivery Layer (approval-queue wiring)

Once a content package passes preflight, the delivery layer pushes it to the appropriate approval queue. Brand-agnostic; the only per-client inputs are `GHL_PIT` and `GHL_LOCATION_ID`.

**Social channel:** `src/delivery/social/` (GHL Social Planner API). Posts are created as drafts (or `scheduled` with an `--approver` flag). The client approves each post in Content > Approval before it publishes.

**Email channel:** GHL v3 templates API (`POST /emails/builder`, `Version: v3` header, `editorContent` with full HTML rendered by `src/email/render.ts` from `brand-config.emailDesignSystem`). Emails are delivered as draft templates in the GHL UI. The client selects recipients and sends from there.

Neither channel auto-schedules or auto-sends. Every artifact requires the client's explicit sign-off.

---

## 3. System diagram

```
  OPERATOR
     |
     | campaign brief (event / theme / audience / register / channel / count)
     v
 +-----------+
 |  BRAIN    |  <-- BRAND-GUIDE.md + brand-voice-pack.md + brand-config.json
 +-----------+
     |
     v
 +-----------+
 | GENERATOR |  produces ContentPackage
 +-----------+
     |
     v
 +-----------+
 | PREFLIGHT |  em-dash scan, register purity, banned phrases,
 +-----------+  CAN-SPAM fields, named-framework fidelity, no invented facts
     |
     | PASS (violations block delivery)
     v
 +---------------------+          +---------------------+
 | SOCIAL DELIVERY     |          | EMAIL DELIVERY      |
 | GHL Social Planner  |          | GHL v3 templates API|
 +---------------------+          +---------------------+
     |                                     |
     v                                     v
 +--------------------------------------------------+
 |           CLIENT'S APPROVAL GATE                 |
 |  Content > Approval (social)                     |
 |  GHL template UI (email)                         |
 |  NOTHING PUBLISHES WITHOUT THEIR SIGN-OFF        |
 +--------------------------------------------------+
     |
     v
  AUDIENCE
```

---

## 4. Channels

| Channel | Platforms | Delivery mechanism | Approval gate |
|---|---|---|---|
| Email | GHL/LeadConnector | v3 templates API, `editorContent`, `Version: v3` header | Client selects list + sends from GHL UI |
| Social (written) | Any GHL-connected platform (typically LinkedIn, Facebook) | GHL Social Planner API, draft/approval route | Content > Approval; client emailed per post |
| Social (video-first) | TikTok, YouTube (`VIDEO_PLATFORMS` in `src/types.ts`) | Manual upload; engine produces script/caption only | Client reviews script before recording |

TikTok and YouTube are video-first. The engine produces video scripts and captions; the client records and uploads. The engine does not push video assets.

---

## 5. Credentials and secrets

The GHL Private Integration Token (`GHL_PIT`) and Location ID (`GHL_LOCATION_ID`) are per-client and operator-held. Both are read from environment variables at runtime and never stored in the repo or any generated artifact. There are no hardcoded defaults for either -- the engine fails loud if they're missing at delivery time.

---

## 6. What changes per client vs. what never does

| Layer | Per-client? | Where it lives |
|---|---|---|
| Register voice, hard rules, content pattern, named frameworks, email design system | Yes | `src/config/brand-config.json` |
| Brand narrative, signature lines, proof points | Yes | `BRAND-GUIDE.md`, `brand-voice-pack.md` |
| GHL credentials | Yes | `GHL_PIT` / `GHL_LOCATION_ID` env vars (repo secrets in CI) |
| Preflight mechanics, generation pipeline, delivery clients, runway calculator | No | `src/**/*.ts` (this is the shared engine) |

A new client never means editing `src/`. See the `client-brand-engine-intake` skill for the onboarding walkthrough.

---

## 7. Optional: scheduled autonomy loop

Once a client is stable, a weekly GitHub Actions scheduled workflow can read a versioned campaign calendar, check a committed state ledger to skip already-queued batches (idempotent), and invoke the launch-kit pipeline (`generateLaunchKit` + `deliverLaunchKit`) for each due event. The golden constraint is unchanged: the loop only pushes to the GHL approval queues. Operator notification should be wired (e.g. Slack incoming webhook) so the loop never runs silently.

This is deliberately not scaffolded by default in this template -- add it per client once the manual flow (`npm run` via the CLIs in `src/agent`, `src/launch`, `src/delivery/social`, `src/email`) has been exercised and trusted for that client.
