/**
 * URL-safe slug helper for event slugs. The action always appends a random
 * suffix (`slugify(orgName)-<nanoid>`), so this need only produce a stable,
 * readable stem — collisions are handled by the suffix, not here.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumerics -> single hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .slice(0, 60);
  return slug || "org";
}
