import "server-only";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { ValidationError } from "@/lib/errors";
import {
  ATTACHMENT_LIMITS,
  attachmentKind,
  capText,
  parseDelimited,
  tableToText,
  unsupportedReason,
  wordHtmlToText,
  type AttachmentKind,
} from "@/lib/domain/attachments";

export type ExtractedAttachment = {
  filename: string;
  kind: AttachmentKind;
  /** Plain text the assistant reads (tables as tab-separated rows). */
  text: string;
  /** Short human summary, e.g. "2 sheets · 48 rows". */
  summary: string;
  truncated: boolean;
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text; // hyperlinks
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formulas
    if ("error" in v) return "";
  }
  return String(v);
}

async function readSpreadsheet(buf: Buffer): Promise<{ text: string; summary: string; truncated: boolean }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const parts: string[] = [];
  let total = 0;
  let truncated = false;
  let sheets = 0;
  wb.eachSheet((ws) => {
    if (ws.state !== "visible") return;
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as ExcelJS.CellValue[]; // 1-indexed
      rows.push(values.slice(1).map(cellText));
    });
    const t = tableToText(rows);
    if (!t.text) return;
    sheets++;
    total += t.rows;
    truncated ||= t.truncated;
    parts.push(`## Sheet: ${ws.name} (${t.rows} rows)\n${t.text}`);
  });
  if (!parts.length) throw new ValidationError("That spreadsheet looks empty.");
  return { text: parts.join("\n\n"), summary: `${sheets} sheet${sheets === 1 ? "" : "s"} · ${total} rows`, truncated };
}

async function readPdf(buf: Buffer): Promise<{ text: string; summary: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  if (!text.trim()) throw new ValidationError("Couldn't find any text in that PDF (it may be a scanned image).");
  return { text, summary: `${totalPages} page${totalPages === 1 ? "" : "s"}` };
}

/** Reads an uploaded file into text for the assistant. Throws ValidationError with a friendly message. */
export async function extractAttachment(file: File): Promise<ExtractedAttachment> {
  const kind = attachmentKind(file.name);
  if (!kind) throw new ValidationError(unsupportedReason(file.name));
  if (file.size > ATTACHMENT_LIMITS.maxBytes) throw new ValidationError("That file is over 3 MB. Try a smaller export (just the sheet or pages you need).");
  const buf = Buffer.from(await file.arrayBuffer());

  let out: { text: string; summary: string; truncated?: boolean };
  try {
    if (kind === "spreadsheet") out = await readSpreadsheet(buf);
    else if (kind === "csv") {
      const t = tableToText(parseDelimited(buf.toString("utf8")));
      if (!t.text) throw new ValidationError("That file looks empty.");
      out = { text: t.text, summary: `${t.rows} rows`, truncated: t.truncated };
    } else if (kind === "word") {
      const { value } = await mammoth.convertToHtml({ buffer: buf });
      const text = wordHtmlToText(value);
      if (!text.trim()) throw new ValidationError("That document looks empty.");
      out = { text, summary: "Word document" };
    } else if (kind === "pdf") out = await readPdf(buf);
    else {
      const text = buf.toString("utf8").trim();
      if (!text) throw new ValidationError("That file looks empty.");
      out = { text, summary: "Text file" };
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    console.error("attachment extract failed", err);
    throw new ValidationError("Couldn't read that file. Check it opens normally, or export it as CSV and try again.");
  }

  const capped = capText(out.text);
  return {
    filename: file.name.slice(0, 200),
    kind,
    text: capped.text,
    summary: out.summary,
    truncated: Boolean(out.truncated) || capped.truncated,
  };
}
