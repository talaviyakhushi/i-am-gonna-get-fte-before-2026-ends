/**
 * Scans a job description for language that rules out visa sponsorship.
 * Returns the matched phrase, or null if no such language is found.
 */
export function detectSponsorshipBlock(description: string): string | null {
  const patterns: RegExp[] = [
    /\bno\b[^.]{0,20}\bsponsorship\b/i,
    /\bnot\b[^.]{0,25}\bsponsor(?:ship)?\b/i,
    /\bwill not sponsor\b/i,
    /\bdoes not sponsor\b/i,
    /\bunable to sponsor\b/i,
    /\bcannot sponsor\b/i,
    /\bwithout\b[^.]{0,20}\bsponsorship\b/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) return match[0];
  }
  return null;
}
