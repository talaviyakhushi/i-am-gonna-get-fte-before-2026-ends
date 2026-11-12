/** job-scanner/notify.ts — emails the day's new matches via Gmail SMTP. */

import nodemailer from "nodemailer";

export interface NotifyJob {
  title: string;
  company: string;
  location: string;
  url: string;
  postedAgo: string;
}

export async function sendDigestEmail(jobs: NotifyJob[], date: string): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.EMAIL_TO || user;

  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD not set — copy job-scanner/.env.example to .env and fill it in.",
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  const byCompany = new Map<string, NotifyJob[]>();
  for (const job of jobs) {
    if (!byCompany.has(job.company)) byCompany.set(job.company, []);
    byCompany.get(job.company)!.push(job);
  }

  const htmlSections = [...byCompany.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([company, companyJobs]) => {
      const items = companyJobs
        .map(
          (j) =>
            `<li><a href="${j.url}">${j.title}</a>${j.location ? ` — ${j.location}` : ""} — <em>${j.postedAgo}</em></li>`,
        )
        .join("\n");
      return `<h3>${company}</h3><ul>${items}</ul>`;
    })
    .join("\n");

  const textLines = [...byCompany.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([company, companyJobs]) => [
      `\n${company}`,
      ...companyJobs.map((j) => `  - ${j.title}${j.location ? ` (${j.location})` : ""} — ${j.postedAgo}\n    ${j.url}`),
    ])
    .join("\n");

  await transporter.sendMail({
    from: user,
    to,
    subject: `${jobs.length} new job match${jobs.length === 1 ? "" : "es"} — ${date}`,
    text: `New matching postings for ${date}:\n${textLines}`,
    html: `<h2>New matching postings — ${date}</h2>${htmlSections}`,
  });
}
