/** Postings older than this are treated as stale and skipped. */
export const STALE_POSTING_THRESHOLD_DAYS = 14;

export interface PostingAge {
  ageDays: number;
  datePosted: string;
}

/** Recursively searches parsed JSON-LD for a JobPosting node's datePosted. */
function findJobPostingDate(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPostingDate(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj["@type"] === "JobPosting" && typeof obj.datePosted === "string") {
      return obj.datePosted;
    }
    if (obj["@graph"]) {
      const found = findJobPostingDate(obj["@graph"]);
      if (found) return found;
    }
  }
  return null;
}

/** Extracts a JobPosting's datePosted from a page's JSON-LD, if present. */
export function extractDatePosted(html: string): string | null {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRegex)) {
    const jsonText = match[1];
    if (!jsonText) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }
    const datePosted = findJobPostingDate(parsed);
    if (datePosted) return datePosted;
  }
  return null;
}

/**
 * Fetches the job posting URL and computes how many days old it is, using
 * the page's schema.org JobPosting structured data (same source sites like
 * howoldisthisjob.com read). Returns null if the page has no such data, is
 * unreachable, or the date doesn't parse — callers should treat null as
 * "unknown" and proceed rather than block.
 */
export async function getPostingAge(url: string): Promise<PostingAge | null> {
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) return null;
    const html = await response.text();
    const datePosted = extractDatePosted(html);
    if (!datePosted) return null;
    const posted = new Date(datePosted);
    if (Number.isNaN(posted.getTime())) return null;
    const ageDays = Math.floor((Date.now() - posted.getTime()) / (1000 * 60 * 60 * 24));
    return { ageDays, datePosted };
  } catch {
    return null;
  }
}
