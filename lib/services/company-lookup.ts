import "server-only";
import { ValidationError } from "@/lib/errors";
import { extractDescription, normalizeDomain, parseSuggestions, type CompanySuggestion } from "@/lib/domain/company-lookup";

const USER_AGENT = "Mozilla/5.0 (compatible; NextStepsDashboard/1.0)";
const MAX_HTML_BYTES = 512 * 1024;

/** Company name autocomplete via Clearbit's free, keyless endpoint. Returns [] if it's unavailable. */
export async function suggestCompanies(query: string): Promise<CompanySuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q.slice(0, 80))}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    return parseSuggestions(await res.json());
  } catch (err) {
    console.warn("company suggest failed", err);
    return [];
  }
}

/** Reads only the start of the page — the <head> is all we need. */
async function readHead(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  while (bytes < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    html += decoder.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  await reader.cancel().catch(() => {});
  return html;
}

/** One-paragraph description from the company's homepage meta tags. */
export async function describeCompany(domainInput: string): Promise<{ domain: string; description: string | null }> {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new ValidationError("That doesn't look like a company website.");
  for (const url of [`https://${domain}`, `https://www.${domain}`]) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) continue;
      const description = extractDescription(await readHead(res));
      if (description) return { domain, description };
    } catch {
      // Try the next variant; many sites only answer on www.
    }
  }
  return { domain, description: null };
}
