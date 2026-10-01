/** Small text helpers shared by integrations (no dependencies, safe on client and server). */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return m;
  });
}

/**
 * Google Calendar descriptions are plain text or light HTML (<br>, <b>, <a>, <ul>…).
 * Returns readable plain text with line breaks kept; links keep their URL so the UI can link them.
 */
export function htmlToText(input: string | null | undefined, maxLength = 4000): string | null {
  if (!input) return null;
  let s = input.replace(/\r\n?/g, "\n");
  if (/<[a-z][\s\S]*>/i.test(s)) {
    s = s
      .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
        const label = text.replace(/<[^>]+>/g, "").trim();
        return !label || label === href ? href : `${label} (${href})`;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(ul|ol)>/gi, "\n\n")
      .replace(/<\/(p|div|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "");
  }
  s = decodeEntities(s)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!s) return null;
  return s.length > maxLength ? `${s.slice(0, maxLength - 1).trimEnd()}…` : s;
}
