/**
 * Lowercase, hyphen-joined slug for tailored-resumes/{date}/{company}/{role} paths.
 * Strips legal suffixes (Inc/LLC/Ltd) and accents, collapses non-alphanumeric
 * runs to a single hyphen, trims leading/trailing hyphens.
 */
export function slugify(input: string): string {
  return input
    .replace(/\b(inc|llc|ltd)\.?(?=\W|$)/gi, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
