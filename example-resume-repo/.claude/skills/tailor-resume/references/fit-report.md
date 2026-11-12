# Fit report schema — short form only

`fit-report.md` is a status readout, not an evaluation essay. The full
strong-matches/gaps/do-not-add analysis still happens internally (it's what
keeps the tailored resume honest) but none of that analysis gets written out.
The whole file is this, nothing more:

```md
# Fit Report — {Company}, {Role}

**Tier:** Strong | Moderate | Stretch
**Verdict:** <verdict line from the table below>

1-2 sentences: the single biggest reason for this tier, and the one gap (if
any) worth knowing before applying.

**Matching keywords:** kw1, kw2, kw3
**Missing keywords:** kw4, kw5
```

Keyword lines: pull only the JD's named tools/skills/technologies (proper
nouns and specific skills — "PostgreSQL", "GraphQL", "RAG" — never soft
skills like "communication" or duty phrases like "own end-to-end delivery").
- **Matching keywords** — JD-named items `resume.md` actually evidences
  (whether or not they made it into this specific tailored resume's word
  budget).
- **Missing keywords** — JD-named items with no evidence anywhere in
  `resume.md`. These are exactly what the hard boundaries already say to
  silently exclude from the resume itself — this line just makes that
  exclusion visible instead of silent.
- Comma-separated, one line each, no bullets/tables. If a list is empty,
  write `none`.

| Tier | Required verdict line |
|------|-----------------------|
| **Strong** | `**Verdict:** Good fit - apply with the tailored resume` |
| **Moderate** | `**Verdict:** Reasonable fit with gaps - review gaps before applying` |
| **Stretch** | `**Verdict:** Too far a stretch for this role - try closer-aligned roles` |

Keep the tier keyword (`Strong`, `Moderate`, or `Stretch`) visible on the
`**Tier:**` line. Do not soften a Stretch verdict by inventing unsupported
experience — say it's a stretch and stop; no bullet lists, no tables.

Target length: under 12 lines total.
