import { describe, expect, it } from "vitest";
import { compareApplications } from "@/lib/domain/application-order";

const app = (name: string, followUp: string | null, updated: string) => ({ name, nextFollowUpAt: followUp ? new Date(followUp) : null, updatedAt: new Date(updated) });
const order = (apps: ReturnType<typeof app>[]) => [...apps].sort(compareApplications).map((a) => a.name);

describe("compareApplications", () => {
  it("puts follow-ups first, nearest (incl. overdue) first", () => {
    expect(
      order([
        app("no-follow-up", null, "2026-09-01"),
        app("next-week", "2026-10-22", "2026-10-14"),
        app("overdue", "2026-10-10", "2026-10-14"),
        app("tomorrow", "2026-10-16", "2026-10-14"),
      ]),
    ).toEqual(["overdue", "tomorrow", "next-week", "no-follow-up"]);
  });

  it("then the rest by last updated, oldest first", () => {
    expect(order([app("fresh", null, "2026-10-14"), app("stale", null, "2026-09-20"), app("mid", null, "2026-10-01")])).toEqual([
      "stale",
      "mid",
      "fresh",
    ]);
  });

  it("breaks follow-up ties by oldest update", () => {
    expect(order([app("b", "2026-10-16", "2026-10-14"), app("a", "2026-10-16", "2026-10-02")])).toEqual(["a", "b"]);
  });

  it("accepts ISO strings (as the client receives them)", () => {
    const s = (n: string, f: string | null, u: string) => ({ name: n, nextFollowUpAt: f, updatedAt: u });
    expect([s("x", null, "2026-10-01T00:00:00Z"), s("y", "2026-10-20T16:00:00Z", "2026-10-14T00:00:00Z")].sort(compareApplications).map((a) => a.name)).toEqual(["y", "x"]);
  });
});
