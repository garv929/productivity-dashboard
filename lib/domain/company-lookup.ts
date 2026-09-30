/** Pure helpers for company enrichment (autocomplete + website description). */

export type CompanySuggestion = { name: string; domain: string };

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "https://www.Ramp.com/careers" → "ramp.com". Null for anything that isn't a public-looking hostname. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (!HOSTNAME.test(host)) return null;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  return host;
}

/** Favicon-based logo; works for any domain without an API key. */
export function logoUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

/** Clearbit autocomplete response → de-duplicated suggestions with valid domains. */
export function parseSuggestions(json: unknown, limit = 6): CompanySuggestion[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  const out: CompanySuggestion[] = [];
  for (const row of json) {
    const r = row as { name?: unknown; domain?: unknown };
    const domain = typeof r.domain === "string" ? normalizeDomain(r.domain) : null;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!domain || !name || seen.has(domain)) continue;
    seen.add(domain);
    out.push({ name: name.slice(0, 120), domain });
    if (out.length >= limit) break;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return m;
  });
}

function metaContent(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
    const k = attr("name") ?? attr("property");
    if (!k || (k[1] ?? k[2]).toLowerCase() !== key) continue;
    const c = attr("content");
    const value = c ? (c[1] ?? c[2]) : "";
    if (value.trim()) return value;
  }
  return null;
}

/** Best one-paragraph description from a homepage's <head>: description → og → twitter → <title>. */
export function extractDescription(html: string, maxLength = 400): string | null {
  const raw =
    metaContent(html, "description") ??
    metaContent(html, "og:description") ??
    metaContent(html, "twitter:description") ??
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ??
    null;
  if (!raw) return null;
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
