import type { TaskLite } from "@/lib/todoist/types";

const DAY = 86_400_000;

function parseLocalDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function formatDue(task: Pick<TaskLite, "due">, today: string): { label: string; tone: "overdue" | "today" | "soon" | "later" } | null {
  if (!task.due) return null;
  const diff = Math.round((parseLocalDate(task.due.date) - parseLocalDate(today)) / DAY);
  const time = task.due.datetime
    ? new Date(task.due.datetime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "")
    : null;
  const date = new Date(parseLocalDate(task.due.date)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const recurring = task.due.isRecurring ? " ↻" : "";
  if (diff < 0) return { label: `${date}${recurring}`, tone: "overdue" };
  if (diff === 0) return { label: `Today${time ? ` ${time}` : ""}${recurring}`, tone: "today" };
  if (diff === 1) return { label: `Tomorrow${time ? ` ${time}` : ""}${recurring}`, tone: "soon" };
  if (diff < 7) {
    const wd = new Date(parseLocalDate(task.due.date)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    return { label: `${wd}${time ? ` ${time}` : ""}${recurring}`, tone: "soon" };
  }
  return { label: `${date}${recurring}`, tone: "later" };
}

export function formatTime(iso: string, tz?: string) {
  return new Date(iso)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })
    .replace(":00", "")
    .replace(" ", "\u202f");
}

export function formatDate(iso: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", opts);
}

export function relativeDays(iso: string | Date | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.round((d.getTime() - now.getTime()) / DAY);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days}d` : `${-days}d ago`;
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** `YYYY-MM-DDTHH:mm` for <input type="datetime-local"> from an ISO instant (browser local time). */
export function toDatetimeLocal(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toDateInput(iso: string | Date | null | undefined): string {
  return toDatetimeLocal(iso).slice(0, 10);
}
