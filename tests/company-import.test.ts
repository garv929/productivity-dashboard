import { describe, expect, it } from "vitest";
import { attachmentKind, capText, parseDelimited, tableToText, unsupportedReason, wordHtmlToText } from "@/lib/domain/attachments";
import { companyKey, pickSuggestion, planImport, searchName } from "@/lib/domain/company-import";

const existing = (over: Partial<Parameters<typeof planImport>[1][number]> & { id: string; name: string }) => ({
  domain: null,
  description: null,
  why: null,
  rolesOfInterest: null,
  tier: null,
  notes: null,
  ...over,
});

describe("reading attachments", () => {
  it("recognises supported files and explains unsupported ones", () => {
    expect(attachmentKind("Targets.XLSX")).toBe("spreadsheet");
    expect(attachmentKind("list.csv")).toBe("csv");
    expect(attachmentKind("notes.docx")).toBe("word");
    expect(attachmentKind("resume.pdf")).toBe("pdf");
    expect(attachmentKind("photo.png")).toBeNull();
    expect(unsupportedReason("old.xls")).toMatch(/save as \.xlsx/);
  });

  it("parses CSV with quotes, embedded commas/newlines and a BOM; detects tabs", () => {
    const csv = '﻿Company,Why\r\nRamp,"Fintech, ops-heavy"\r\n"Figma","Design\nculture, ""craft"""\r\n';
    expect(parseDelimited(csv)).toEqual([
      ["Company", "Why"],
      ["Ramp", "Fintech, ops-heavy"],
      ["Figma", 'Design\nculture, "craft"'],
    ]);
    expect(parseDelimited("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("turns tables into tab-separated text, dropping empty rows/columns and capping rows", () => {
    const t = tableToText([["Company", "", "Tier"], ["", "", ""], ["Ramp", "", "1"], ["Figma\tInc", "", "2"]]);
    expect(t.text).toBe("Company\tTier\nRamp\t1\nFigma Inc\t2");
    expect(t.rows).toBe(2);
    const big = tableToText([["Name"], ...Array.from({ length: 10 }, (_, i) => [`Co ${i}`])], 3);
    expect(big).toMatchObject({ rows: 3, truncated: true });
  });

  it("keeps Word tables and lists readable", () => {
    const html =
      "<p>My <strong>targets</strong></p><table><tr><td><p>Company</p></td><td><p>Tier</p></td></tr><tr><td><p>Ramp &amp; Co</p></td><td><p>1</p></td></tr></table><ul><li>Notion – maybe</li></ul>";
    expect(wordHtmlToText(html)).toBe("My targets\n[Table]\nCompany\tTier\nRamp & Co\t1\n\n• Notion – maybe");
  });

  it("caps very long text with a note", () => {
    const out = capText("x".repeat(30), 10);
    expect(out.truncated).toBe(true);
    expect(out.text.startsWith("xxxxxxxxxx\n…[truncated")).toBe(true);
  });
});

describe("planning a company import", () => {
  it("matches names written differently", () => {
    expect(companyKey("Ramp, Inc.")).toBe(companyKey(" ramp "));
    expect(companyKey("Johnson & Johnson")).toBe("johnson and johnson");
    expect(companyKey("Société Générale")).toBe("societe generale");
  });

  it("creates new companies, fills only empty fields on existing ones, and skips duplicates", () => {
    const plan = planImport(
      [
        { name: "Ramp, Inc.", domain: "https://www.ramp.com/careers", why: "New why", tier: "tier_1", notes: "Referral via Priya" },
        { name: "Figma", tier: "tier_2", rolesOfInterest: "Solutions Engineer" },
        { name: "figma", tier: "tier_3" },
        { name: "Notion", domain: "notion.so" },
        { name: "  " },
      ],
      [existing({ id: "r1", name: "Ramp", why: "Existing why", tier: "tier_2" }), existing({ id: "n1", name: "Notion Labs", domain: "notion.so", tier: null })],
    );
    expect(plan.creates.map((r) => [r.name, r.tier, r.rolesOfInterest])).toEqual([["Figma", "tier_2", "Solutions Engineer"]]);
    expect(plan.updates).toEqual([{ id: "r1", name: "Ramp", patch: { domain: "ramp.com", notes: "Referral via Priya", tier: "tier_1" } }]);
    expect(plan.skipped).toEqual([
      { name: "figma", reason: "listed twice in the file" },
      { name: "Notion Labs", reason: "already up to date" },
    ]);
  });

  it("searches with the name as written, minus legal suffixes", () => {
    expect(searchName("Figma, Inc.")).toBe("Figma");
    expect(searchName("Johnson & Johnson")).toBe("Johnson & Johnson");
    expect(searchName("Stripe Inc")).toBe("Stripe");
    expect(searchName("Co")).toBe("Co");
  });

  it("only trusts autocomplete results with the same company name", () => {
    const s = [
      { name: "Anthropics", domain: "anthropics.com" },
      { name: "Anthropic", domain: "anthropic.com" },
    ];
    expect(pickSuggestion("Anthropic", s)?.domain).toBe("anthropic.com");
    expect(pickSuggestion("Acme", s)).toBeNull();
  });
});
