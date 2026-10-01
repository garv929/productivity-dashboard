import { describe, expect, it } from "vitest";
import { htmlToText } from "@/lib/domain/text";

describe("htmlToText (Google Calendar descriptions)", () => {
  it("returns null for empty input", () => {
    expect(htmlToText(null)).toBeNull();
    expect(htmlToText("   ")).toBeNull();
    expect(htmlToText("<br><br>")).toBeNull();
  });

  it("leaves plain text alone apart from trimming", () => {
    expect(htmlToText("  Prep STAR stories\nThen apply to 2 roles  ")).toBe("Prep STAR stories\nThen apply to 2 roles");
  });

  it("turns line breaks, paragraphs and lists into newlines and bullets", () => {
    expect(htmlToText("<p>Agenda</p><ul><li>Ramp</li><li>Figma</li></ul>Bring <b>resume</b>")).toBe("Agenda\n\n• Ramp\n• Figma\n\nBring resume");
    expect(htmlToText("Line one<br>Line two<br/>Line three")).toBe("Line one\nLine two\nLine three");
  });

  it("keeps link URLs so they can be clicked", () => {
    expect(htmlToText('Join: <a href="https://meet.google.com/abc-defg-hij">https://meet.google.com/abc-defg-hij</a>')).toBe(
      "Join: https://meet.google.com/abc-defg-hij",
    );
    expect(htmlToText('See <a href="https://ramp.com/careers">careers page</a>')).toBe("See careers page (https://ramp.com/careers)");
  });

  it("decodes entities and collapses runs of blank lines", () => {
    expect(htmlToText("Q&amp;A&nbsp;prep<br><br><br><br>Done &#8211; nice")).toBe("Q&A prep\n\nDone – nice");
  });

  it("truncates very long descriptions", () => {
    const out = htmlToText("x".repeat(50), 20)!;
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
  });
});
