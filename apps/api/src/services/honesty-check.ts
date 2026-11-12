import type { JobPayload } from "@resume-tailor/shared";

/**
 * Scans lines added by the agent for claims (metrics, percentages, dollar
 * amounts, years) that do not appear in the original resume or the job
 * description. Returns human-readable warnings; never blocks the PR.
 */
export function honestyCheck(
  originalResume: string,
  diffText: string,
  job: JobPayload,
): string[] {
  const warnings: string[] = [];
  const knownText = `${originalResume}\n${job.description}\n${job.title}\n${job.company}`;

  const addedLines = diffText
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));

  const claimPatterns: Array<{ label: string; regex: RegExp }> = [
    { label: "percentage", regex: /\d+(?:\.\d+)?\s*%/g },
    { label: "dollar amount", regex: /\$\s?\d[\d,.]*[kKmMbB]?/g },
    { label: "large number", regex: /\b\d{1,3}(?:,\d{3})+\b|\b\d{4,}\b/g },
    { label: "multiplier", regex: /\b\d+(?:\.\d+)?x\b/gi },
  ];

  const seen = new Set<string>();
  for (const line of addedLines) {
    for (const { label, regex } of claimPatterns) {
      for (const match of line.matchAll(regex)) {
        const claim = match[0].trim();
        // Years read like large numbers but are usually date ranges — skip
        // ones already present anywhere in the known text.
        if (seen.has(claim) || knownText.includes(claim)) continue;
        seen.add(claim);
        warnings.push(
          `New ${label} "${claim}" not found in original resume or job posting — verify it is accurate. Line: "${line.trim()}"`,
        );
      }
    }
  }

  return warnings;
}
