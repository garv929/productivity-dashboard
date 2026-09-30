import { describe, expect, it } from "vitest";
import { extractDescription, normalizeDomain, parseSuggestions } from "@/lib/domain/company-lookup";

describe("normalizeDomain", () => {
  it("strips protocol, www, path, port and case", () => {
    expect(normalizeDomain("https://www.Ramp.com/careers?x=1")).toBe("ramp.com");
    expect(normalizeDomain("ramp.com:443")).toBe("ramp.com");
    expect(normalizeDomain(" jobs.lever.co ")).toBe("jobs.lever.co");
  });

  it("rejects things that aren't public hostnames", () => {
    for (const bad of ["", "ramp", "localhost", "127.0.0.1", "http://10.0.0.1/", "foo.localhost", "printer.local", "a b.com"]) {
      expect(normalizeDomain(bad), bad).toBeNull();
    }
  });
});

describe("parseSuggestions", () => {
  it("keeps valid rows, drops duplicates and junk", () => {
    const rows = [
      { name: "Ramp", domain: "ramp.com", logo: null },
      { name: "Ramp dup", domain: "www.ramp.com" },
      { name: "", domain: "empty.com" },
      { name: "No domain" },
      { name: "Rampant", domain: "rampant.tv" },
    ];
    expect(parseSuggestions(rows)).toEqual([
      { name: "Ramp", domain: "ramp.com" },
      { name: "Rampant", domain: "rampant.tv" },
    ]);
    expect(parseSuggestions({ error: "nope" })).toEqual([]);
  });
});

describe("extractDescription", () => {
  it("prefers meta description, in either attribute order", () => {
    expect(extractDescription(`<head><meta content="Spend &amp; save." name="description"><meta property="og:description" content="OG"></head>`)).toBe("Spend & save.");
  });

  it("falls back to og, twitter, then title", () => {
    expect(extractDescription(`<meta property='og:description' content='From OG'>`)).toBe("From OG");
    expect(extractDescription(`<meta name="twitter:description" content="From Twitter">`)).toBe("From Twitter");
    expect(extractDescription(`<title> Acme &#8211; Widgets </title>`)).toBe("Acme – Widgets");
    expect(extractDescription(`<meta name="description" content="  "><title>T</title>`)).toBe("T");
    expect(extractDescription("<p>nothing</p>")).toBeNull();
  });

  it("collapses whitespace and truncates", () => {
    const long = "word ".repeat(200);
    const out = extractDescription(`<meta name="description" content="${long}">`, 50)!;
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
  });
});
