/**
 * job-scanner/scan.ts — pulls current postings from all resolved companies'
 * ATS boards, filters titles down to relevant new-grad/entry-level roles,
 * and reports what's new since the last run.
 *
 * Usage:
 *   npx tsx job-scanner/scan.ts              # scan + write results/seen.json + email if new matches
 *   npx tsx job-scanner/scan.ts --dry-run     # scan + print only, no writes, no email
 *   npx tsx job-scanner/scan.ts --no-email    # scan + write, skip sending email
 */

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendDigestEmail } from "./notify.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
// Explicit path — dotenv's auto-load only checks the current working
// directory, which is the repo root when run via `npx tsx job-scanner/scan.ts`,
// not this file's own directory.
loadEnv({ path: path.join(DIR, ".env") });
const COMPANIES_PATH = path.join(DIR, "companies.json");
const SEEN_PATH = path.join(DIR, "seen.json");
const RESULTS_DIR = path.join(DIR, "results");

const CONCURRENCY = 15;

// ── Title filter — exact lists as given, not merged with anything else ──

const INCLUDE_KEYWORDS = [
  "new grad", "new-grad", "university grad", "early career",
  "entry level", "entry-level", "associate software", "campus",
  "class of 2026", "recent graduate",
  "software engineer i", "software engineer 1", "sde i", "sde 1",
  "swe i", "swe 1", "software developer", "full stack",
  "full-stack", "fullstack", "backend engineer", "back-end engineer",
  "application developer", "graduate software",
];

const EXCLUDE_KEYWORDS = [
  "senior", "sr.", "staff", "principal", "lead ", "manager",
  "director", "architect", "ii", "iii", "iv", " v ", "2+ years", "3+ years","2027",
  "5+ years", "7+ years", "10+ years",
];

// Word-boundary matching, not raw substring — plain .includes() lets
// "software engineer i" match "...engineer Intern" (the "i" from Intern)
// and lets exclude keyword "iv" match inside "Executive"/"Innovative".
// Trimming keywords first (so "lead " / " v " become "lead" / "v") then
// wrapping in \b...\b fixes both without changing the keyword lists.
function toWordBoundaryRegex(keyword: string): RegExp {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

const INCLUDE_PATTERNS = INCLUDE_KEYWORDS.map(toWordBoundaryRegex);
const EXCLUDE_PATTERNS = EXCLUDE_KEYWORDS.map(toWordBoundaryRegex);

function titleMatches(title: string): boolean {
  const included = INCLUDE_PATTERNS.some((r) => r.test(title));
  const excluded = EXCLUDE_PATTERNS.some((r) => r.test(title));
  return included && !excluded;
}

// ── Location filter — block non-US, benefit-of-doubt on empty/ambiguous ──
// An empty location field (real ATS boards do this even for genuine US
// roles — see Stripe's "N/A" entries) isn't treated as foreign; only an
// explicit non-US country/city name blocks a posting. Word-boundary
// matching avoids collisions like "Georgia" (US state) never being listed
// here, and "UK"/"US" style short codes not accidentally matching inside
// unrelated words.

const LOCATION_BLOCK_KEYWORDS = [
  "india", "bengaluru", "pune", "hyderabad", "mumbai", "delhi",
  "united kingdom", "uk", "london",
  "germany", "berlin", "munich",
  "france", "paris",
  "poland", "warsaw",
  "switzerland", "zurich",
  "spain", "madrid", "barcelona",
  "netherlands", "amsterdam",
  "sweden", "stockholm",
  "austria", "vienna",
  "ireland", "dublin",
  "singapore",
  "japan", "tokyo",
  "south korea", "seoul",
  "china", "beijing", "shanghai", "guangzhou", "hong kong",
  "brazil",
  "mexico",
  "australia", "sydney",
  "canada", "toronto", "montreal", "montréal", "vancouver",
  "emea", "apac", "latam",
];

const LOCATION_BLOCK_PATTERNS = LOCATION_BLOCK_KEYWORDS.map(toWordBoundaryRegex);

function locationIsUS(location: string): boolean {
  if (!location) return true; // benefit of the doubt — many real US postings omit location
  return !LOCATION_BLOCK_PATTERNS.some((r) => r.test(location));
}

// ── Types ─────────────────────────────────────────────────────────────

interface Company {
  name: string;
  ats: "greenhouse" | "lever" | "ashby";
  slug: string;
  city?: string;
  state?: string;
  legal_name?: string;
}

interface Job {
  title: string;
  url: string;
  company: string;
  location: string;
  /** ISO timestamp the posting went live, per the ATS's own field — null if unavailable. */
  postedAt: string | null;
  /** Plain-text job description — empty for Greenhouse until backfilled (see fetchGreenhouseDescription). */
  description: string;
  /** Greenhouse-only: numeric job id, needed to fetch full content on demand. */
  ghJobId?: number;
  /** Greenhouse-only: board slug, needed alongside ghJobId. */
  ghSlug?: string;
}

/** Strips HTML tags and decodes the handful of entities that show up in job descriptions. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function daysAgo(iso: string | null): string {
  if (!iso) return "unknown age";
  const posted = new Date(iso).getTime();
  if (Number.isNaN(posted)) return "unknown age";
  const days = Math.floor((Date.now() - posted) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ── Provider fetchers — same endpoint shapes validated earlier this session ──

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchGreenhouse(company: Company): Promise<Job[]> {
  const json = (await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs`,
  )) as {
    jobs?: Array<{
      id?: number;
      title?: string;
      absolute_url?: string;
      location?: { name?: string };
      first_published?: string;
      updated_at?: string;
    }>;
  };
  const jobs = Array.isArray(json.jobs) ? json.jobs : [];
  return jobs
    .filter((j) => j.absolute_url)
    .map((j) => ({
      title: j.title ?? "",
      url: j.absolute_url as string,
      company: company.name,
      location: j.location?.name ?? "",
      // first_published is the true post date; updated_at moves on edits.
      postedAt: j.first_published ?? j.updated_at ?? null,
      // Greenhouse's list endpoint doesn't include the description — backfilled
      // on demand in main() only for jobs that already passed the title filter.
      description: "",
      ghJobId: j.id,
      ghSlug: company.slug,
    }));
}

/** Greenhouse-only: the list endpoint omits description, so fetch it per-job. */
async function fetchGreenhouseDescription(slug: string, jobId: number): Promise<string> {
  const json = (await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}?content=true`,
  )) as { content?: string };
  return stripHtml(json.content ?? "");
}

async function fetchLever(company: Company): Promise<Job[]> {
  const json = (await fetchJson(
    `https://api.lever.co/v0/postings/${company.slug}?mode=json`,
  )) as Array<{
    text?: string;
    hostedUrl?: string;
    categories?: { location?: string };
    createdAt?: number;
    descriptionPlain?: string;
  }>;
  if (!Array.isArray(json)) return [];
  return json
    .filter((j) => j.hostedUrl)
    .map((j) => ({
      title: j.text ?? "",
      url: j.hostedUrl as string,
      company: company.name,
      location: j.categories?.location ?? "",
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      description: j.descriptionPlain ?? "",
    }));
}

async function fetchAshby(company: Company): Promise<Job[]> {
  const json = (await fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${company.slug}`,
  )) as {
    jobs?: Array<{
      title?: string;
      jobUrl?: string;
      location?: string;
      publishedAt?: string;
      descriptionPlain?: string;
    }>;
  };
  const jobs = Array.isArray(json.jobs) ? json.jobs : [];
  return jobs
    .filter((j) => j.jobUrl)
    .map((j) => ({
      title: j.title ?? "",
      url: j.jobUrl as string,
      company: company.name,
      location: j.location ?? "",
      postedAt: j.publishedAt ?? null,
      description: j.descriptionPlain ?? "",
    }));
}

async function fetchForCompany(company: Company): Promise<Job[]> {
  switch (company.ats) {
    case "greenhouse":
      return fetchGreenhouse(company);
    case "lever":
      return fetchLever(company);
    case "ashby":
      return fetchAshby(company);
    default:
      return [];
  }
}

// ── Concurrency-limited fetch ────────────────────────────────────────

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function next(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const noEmail = process.argv.includes("--no-email");

  const companies: Company[] = JSON.parse(readFileSync(COMPANIES_PATH, "utf-8"));
  const seen: Set<string> = new Set(
    existsSync(SEEN_PATH) ? JSON.parse(readFileSync(SEEN_PATH, "utf-8")) : [],
  );

  let totalFound = 0;
  let totalFilteredTitle = 0;
  let totalFilteredLocation = 0;
  let totalFilteredBody = 0;
  let totalDupes = 0;
  const errors: { company: string; error: string }[] = [];
  const newJobs: Job[] = [];

  await withConcurrency(companies, CONCURRENCY, async (company) => {
    let jobs: Job[];
    try {
      jobs = await fetchForCompany(company);
    } catch (err) {
      errors.push({ company: company.name, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    totalFound += jobs.length;
    for (const job of jobs) {
      if (!titleMatches(job.title)) {
        totalFilteredTitle++;
        continue;
      }
      if (!locationIsUS(job.location)) {
        totalFilteredLocation++;
        continue;
      }
      // Experience-level gates ("3+ years") almost never show up in the
      // title — they live in the qualifications section of the body.
      // Ashby/Lever already gave us descriptionPlain for free; Greenhouse's
      // list endpoint doesn't include it, so backfill it here, but only for
      // candidates that already cleared title+location (cheap — a few
      // hundred requests a day, not one per posting across all companies).
      let description = job.description;
      if (!description && job.ghJobId && job.ghSlug) {
        try {
          description = await fetchGreenhouseDescription(job.ghSlug, job.ghJobId);
        } catch {
          description = ""; // fall back to title-only exclude check
        }
      }
      if (EXCLUDE_PATTERNS.some((r) => r.test(description))) {
        totalFilteredBody++;
        continue;
      }
      if (seen.has(job.url)) {
        totalDupes++;
        continue;
      }
      seen.add(job.url);
      newJobs.push(job);
    }
  });

  // ── Write results ──
  const date = new Date().toISOString().slice(0, 10);
  if (!dryRun && newJobs.length > 0) {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const byCompany = new Map<string, Job[]>();
    for (const job of newJobs) {
      if (!byCompany.has(job.company)) byCompany.set(job.company, []);
      byCompany.get(job.company)!.push(job);
    }
    const lines: string[] = [`# Job scan — ${date}`, ""];
    for (const [company, jobs] of [...byCompany.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`## ${company}`);
      // Newest posting first; unknown-age postings sort last within the company.
      const sorted = [...jobs].sort((a, b) => {
        const at = a.postedAt ? new Date(a.postedAt).getTime() : -Infinity;
        const bt = b.postedAt ? new Date(b.postedAt).getTime() : -Infinity;
        return bt - at;
      });
      for (const job of sorted) {
        lines.push(
          `- [${job.title}](${job.url})${job.location ? ` — ${job.location}` : ""} — ${daysAgo(job.postedAt)}`,
        );
      }
      lines.push("");
    }
    writeFileSync(path.join(RESULTS_DIR, `${date}.md`), lines.join("\n"), "utf-8");
  }
  if (!dryRun) {
    writeFileSync(SEEN_PATH, JSON.stringify([...seen], null, 2), "utf-8");
  }

  // ── Email digest ──
  let emailError: string | null = null;
  if (!dryRun && !noEmail && newJobs.length > 0) {
    try {
      await sendDigestEmail(
        newJobs.map((j) => ({
          title: j.title,
          company: j.company,
          location: j.location,
          url: j.url,
          postedAgo: daysAgo(j.postedAt),
        })),
        date,
      );
    } catch (err) {
      // Don't fail the whole run over email — results/seen.json are already
      // written above, so a bad SMTP config shouldn't lose the scan itself.
      emailError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Summary ──
  console.log(`\n${"━".repeat(45)}`);
  console.log(`Job Scan — ${date}${dryRun ? " (dry run)" : ""}`);
  console.log("━".repeat(45));
  console.log(`Companies scanned:     ${companies.length}`);
  console.log(`Total postings found:  ${totalFound}`);
  console.log(`Filtered by title:     ${totalFilteredTitle} removed`);
  console.log(`Filtered by location:  ${totalFilteredLocation} removed`);
  console.log(`Filtered by JD body:   ${totalFilteredBody} removed (e.g. "3+ years" in qualifications)`);
  console.log(`Duplicates (seen):     ${totalDupes} skipped`);
  console.log(`New matches:           ${newJobs.length}`);
  if (!dryRun && !noEmail && newJobs.length > 0) {
    console.log(emailError ? `Email:                 FAILED — ${emailError}` : "Email:                 sent");
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ ${e.company}: ${e.error}`);
  }

  if (newJobs.length > 0) {
    console.log("\nNew matches:");
    for (const job of newJobs) {
      console.log(`  + ${job.company} | ${job.title} | ${job.location || "N/A"} | ${daysAgo(job.postedAt)}`);
    }
    if (!dryRun) {
      console.log(`\nSaved to job-scanner/results/${date}.md`);
    }
  }

  // Scan data is already safely written above — a non-zero exit here only
  // flags the email failure for CI visibility, it doesn't undo the scan.
  if (emailError) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
