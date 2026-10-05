/**
 * Antikvaari.fi, Finland's marketplace for second-hand books — used by the
 * Evaluate tab to see what a book sells for (docs/spec-corrections.md §17).
 *
 * Only a plain link: Antikvaari forbids showing its pages inside another site
 * (X-Frame-Options: SAMEORIGIN), so nothing is embedded, fetched or copied.
 * The search address is the one the site itself publishes (its schema.org
 * SearchAction); it accepts an ISBN-13, with or without hyphens, an ISBN-10,
 * or words (a title, an author) for books whose barcode is covered.
 */
export function antikvaariSearchUrl(query: string): string {
  return `https://www.antikvaari.fi/hakukone?q=${encodeURIComponent(query.trim())}`;
}
