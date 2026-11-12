# Example resume repo (template)

This is the shape **your own resume repository** needs — a separate GitHub repo
in practice, not part of this monorepo's runtime. Copy these files into your
resume repo, replace `resume.md` with your real master resume, and point
`RESUME_REPO_URL` in `apps/api/.env` at it.

```
your-resume-repo/
  resume.md                              # your master resume (source of truth)
  .claude/skills/tailor-resume/SKILL.md  # instructions the agent reads at run time
  jobs/                                  # created by the agent, one folder per application
    {company-slug}/{role-slug}/
      resume.md                          # tailored resume
      fit-report.md                      # how your experience maps to the posting
```

The agent clones this repo, reads `SKILL.md`, writes the tailored output under
`jobs/`, and opens a PR. Your master `resume.md` is never modified.
