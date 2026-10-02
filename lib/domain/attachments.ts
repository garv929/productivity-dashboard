/** Pure helpers for turning uploaded files into text the assistant can read. */

import { decodeEntities, htmlToText } from "./text";

export const ATTACHMENT_LIMITS = {
  maxBytes: 3 * 1024 * 1024,
  maxFiles: 3,
  /** Characters of extracted text kept per file (~15k tokens). */
  maxChars: 60_000,
  maxRowsPerSheet: 500,
} as const;

export type AttachmentKind = "spreadsheet" | "csv" | "word" | "pdf" | "text";

const BY_EXTENSION: Record<string, AttachmentKind> = {
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  csv: "csv",
  tsv: "csv",
  docx: "word",
  pdf: "pdf",
  txt: "text",
  md: "text",
  markdown: "text",
};

export const ACCEPTED_EXTENSIONS = Object.keys(BY_EXTENSION).map((e) => `.${e}`);

/** What kind of file this is, from its name; null if we can't read it. */
export function attachmentKind(filename: string): AttachmentKind | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

export function unsupportedReason(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "xls") return "Old .xls files aren't supported. Open it in Excel and save as .xlsx.";
  if (ext === "doc") return "Old .doc files aren't supported. Open it in Word and save as .docx.";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "Images aren't supported yet. Attach a PDF, Excel, Word, CSV or text file.";
  return "That file type isn't supported. Attach a PDF, Excel (.xlsx), Word (.docx), CSV or text file.";
}

/** Minimal RFC 4180 CSV/TSV parser: quoted fields, escaped quotes, newlines inside quotes. */
export function parseDelimited(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = delimiter ?? (firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const clean = (v: string) => v.replace(/[\t\r\n]+/g, " ").trim();

/**
 * A table as tab-separated lines, header first. Drops empty rows and fully empty
 * columns, and caps the row count so huge sheets don't flood the model.
 */
export function tableToText(rows: string[][], maxRows: number = ATTACHMENT_LIMITS.maxRowsPerSheet): { text: string; rows: number; truncated: boolean } {
  const nonEmpty = rows.map((r) => r.map(clean)).filter((r) => r.some((v) => v !== ""));
  if (nonEmpty.length === 0) return { text: "", rows: 0, truncated: false };
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const keep = Array.from({ length: width }, (_, c) => nonEmpty.some((r) => (r[c] ?? "") !== ""));
  const shaped = nonEmpty.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? "").filter((_, c) => keep[c]));
  const truncated = shaped.length - 1 > maxRows;
  const body = shaped.slice(0, maxRows + 1);
  return { text: body.map((r) => r.join("\t")).join("\n"), rows: body.length - 1, truncated };
}

/** Word HTML (from mammoth) → text, keeping tables as tab-separated rows and lists as bullets. */
export function wordHtmlToText(html: string): string {
  const tables: string[] = [];
  const withPlaceholders = html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((tr) =>
      [...tr[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => decodeEntities(cell[1].replace(/<[^>]+>/g, " "))),
    );
    tables.push(tableToText(rows).text);
    return `<p>@@TABLE${tables.length - 1}@@</p>`;
  });
  const text = htmlToText(withPlaceholders, Number.MAX_SAFE_INTEGER) ?? "";
  return text.replace(/@@TABLE(\d+)@@/g, (_m, i: string) => `[Table]\n${tables[Number(i)]}`).trim();
}

/** Trims to the per-file character budget, noting when something was cut. */
export function capText(text: string, maxChars: number = ATTACHMENT_LIMITS.maxChars): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n…[truncated: the file was longer than the assistant can read at once]`, truncated: true };
}
