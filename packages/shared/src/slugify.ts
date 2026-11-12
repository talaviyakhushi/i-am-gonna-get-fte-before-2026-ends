/**
 * Lowercase, replace runs of non-alphanumeric characters with single hyphens,
 * trim leading/trailing hyphens. Used for branch names and jobs/{company}/{role} paths.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
