# Brand-voice pack: [Client Name]

One pack per client. Loaded explicitly at the start of a job; voice never leaks between clients. The pack is ready to use only when the `compliance` block is complete -- no send clears preflight without it.

> This is a fill-in-the-blank scaffold. It's the machine-readable distillation of `BRAND-GUIDE.md` -- keep it consistent with that document, don't contradict it. Fill in every field; mark anything you don't yet know as `> TODO: open question - needs human decision`. The engine never invents facts to fill a gap.

- **client**: [Client Name]

- **one_liner**: [one sentence -- role, credentials, core promise]

- **voice**: [1-2 paragraphs describing exactly how they write: sentence rhythm, person (first/second), formality, what they lean on (stories, data, humor), what they never do]

- **registers** (delete this block entirely if there's only one voice):
  - **[Register 1]** ([where it's used]): [feel, palette/typography notes if visually distinct]
  - **[Register 2]** ([where it's used]): [feel, palette/typography notes if visually distinct]

- **signature_devices**:
  - **[Device name, e.g. "the truth bomb"]**: [the repeatable pattern, as an ordered list]
  - **[Any other recurring device]**: [description]

- **do**:
  - [specific, actionable]
  - [specific, actionable]

- **dont**:
  - No em dashes (project hard rule). Use commas, colons, parentheses, periods, semicolons.
  - [client-specific "don't"]
  - Do not invent client stats, client names, or offers beyond those recorded here.

- **offers** (for the current campaign; update per campaign):
  - **[Offer name]**: [what it is, transformation promised]

- **assets**:
  - **[Book/course/signature asset]**: [title, what it's the source of]
  - **Signature lines** (use verbatim where they fit):
    - "[line]"
  - **Social proof** (use sparingly, only true claims): [confirmed stats/logos]

- **design_system** (keep in sync with `src/config/brand-config.json` -> `emailDesignSystem`; 620px email width):
  - palette: background `#______`, primary `#______`, accent `#______`, secondary `#______`, emphasis `#______`.
  - type: [heading font] (headings) + [body font] (body).
  - logo: `[url]` (alt text: "[client name]").
  - block structure: [list the block order].
  - merge tokens (confirmed): `{{contact.first_name}}` and `{{email.unsubscribe_link}}`. Use only these plus whatever is in `brand-config.confirmedMergeTokens`.

- **proven_sequences**: [if the client has a track record, describe the escalation shape of a prior successful campaign here -- e.g. "12-email runway: announcement (2) -> value (3) -> urgency (3) -> day-before (2) -> day-of (2)". Leave as `> TODO: no track record yet` for a brand-new client.]

- **compliance**:
  - from_identity: > TODO: open question - needs human decision. Operator to supply the exact From name + From address.
  - reply_to: > TODO: open question - needs human decision.
  - physical_address: > TODO: open question - needs human decision. Required in the CAN-SPAM footer; no send clears preflight without it.
  - sending_domain: > TODO: open question - needs human decision. Confirm SPF/DKIM/DMARC alignment.
  - bimi_path: > TODO: open question - needs human decision (optional; only if pursuing a BIMI logo-in-inbox route).

> Any field marked `> TODO: open question - needs human decision` must be supplied by the operator before the affected asset ships. Do not invent client facts.
