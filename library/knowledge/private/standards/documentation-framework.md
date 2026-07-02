# Documentation Framework

> Category: Standards | Version: 1.0 | Date: 2026 | Status: Active

Ground rules for all documentation in `client-brand-engine/library/`.

**Related:**
- [Architecture Overview](../brand-engine/architecture-overview.md)

---

## Schema

Library schema v2. See `library-guardian` for the full spec.

## Writing rules

1. No em dashes in any doc (hard rule, matches the engine's own preflight rule -- practice what the engine enforces).
2. Forward PRDs go in `requirements/backlog/`. Backwards-PRDs for shipped code go in `requirements/completed/`.
3. Acceptance criteria use the `| AC-N | Given/When/Then |` table format.
4. Knowledge docs open with the standard header: title, category/version/date/status, one-sentence description, Related links.
5. QA report content is authored only by `quality-guardian`; `library-guardian` owns the folder structure.
6. `library/notes/` is human-only; no agent writes there.
