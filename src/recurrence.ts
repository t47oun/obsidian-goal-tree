import type { RecurrenceRule } from "./engine";

export type WeekStart = "sunday" | "monday" | "saturday";

export interface PlannedRecurrenceOccurrence {
  key: string;
  start: string;
  scheduled?: string;
  due: string;
  ordinal?: number;
}

export function nextRecurrenceDate(
  iso: string,
  rule: RecurrenceRule,
  interval = 1
): string | undefined {
  if (rule === "none") return undefined;
  const step = Math.max(1, Math.round(interval));
  const date = parseIsoDate(iso);
  if (!date) return undefined;
  if (rule === "daily" || rule === "weekdays" || rule === "specific-weekdays" || rule === "weekly-target") {
    return undefined;
  }

  if (rule === "weekly") return formatIsoDate(addUtcDays(date, step * 7));
  if (rule === "monthly") {
    const day = date.getUTCDate();
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + step, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return formatIsoDate(target);
  }

  return undefined;
}

export function normalizeWeekdays(values: readonly number[] | undefined): number[] {
  if (!values) return [];
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))]
    .sort((a, b) => a - b);
}

/** Builds current-week occurrences without filling the vault with distant future notes. */
export function planRecurringOccurrences(
  seriesId: string,
  rule: RecurrenceRule,
  today: string,
  seriesStart: string,
  seriesEnd: string | undefined,
  weekdays: readonly number[] | undefined,
  weeklyTarget: number | undefined,
  weekStartsOn: WeekStart,
  weeksAhead = 0
): PlannedRecurrenceOccurrence[] {
  if (rule !== "daily" && rule !== "weekdays" && rule !== "specific-weekdays" && rule !== "weekly-target") return [];
  if (!parseIsoDate(today) || !parseIsoDate(seriesStart) || (seriesEnd && !parseIsoDate(seriesEnd))) return [];

  const current = weekRange(today, weekStartsOn);
  const rangeStart = current.start > seriesStart ? current.start : seriesStart;
  let rangeEnd = shiftIsoDate(current.end, Math.max(0, Math.round(weeksAhead)) * 7) ?? current.end;
  if (seriesEnd && rangeEnd > seriesEnd) rangeEnd = seriesEnd;
  if (rangeStart > rangeEnd) return [];

  const selectedDays = rule === "daily"
    ? [0, 1, 2, 3, 4, 5, 6]
    : rule === "weekdays"
      ? normalizeWeekdays(weekdays).length > 0 ? normalizeWeekdays(weekdays) : [0, 1, 2, 3, 4]
      : normalizeWeekdays(weekdays);
  if (rule !== "weekly-target") {
    if (selectedDays.length === 0) return [];
    const occurrences: PlannedRecurrenceOccurrence[] = [];
    for (let cursor = rangeStart; cursor <= rangeEnd; cursor = shiftIsoDate(cursor, 1) ?? "") {
      const date = parseIsoDate(cursor);
      if (!date || !selectedDays.includes(date.getUTCDay())) continue;
      occurrences.push({
        key: `${seriesId}:day:${cursor}`,
        start: cursor,
        scheduled: cursor,
        due: cursor
      });
    }
    return occurrences;
  }

  const target = Math.max(1, Math.round(weeklyTarget ?? 1));
  const plans: PlannedRecurrenceOccurrence[] = [];
  const periodStarts = Array.from(
    { length: Math.max(0, Math.round(weeksAhead)) + 1 },
    (_, index) => shiftIsoDate(current.start, index * 7)!
  );
  for (const periodStart of periodStarts) {
    const periodEnd = shiftIsoDate(periodStart, 6)!;
    const boundedStart = periodStart > seriesStart ? periodStart : seriesStart;
    const boundedEnd = seriesEnd && seriesEnd < periodEnd ? seriesEnd : periodEnd;
    if (boundedStart > boundedEnd) continue;
    const allowed = datesBetweenInclusive(boundedStart, boundedEnd).filter((date) => {
      if (selectedDays.length === 0) return true;
      return selectedDays.includes(parseIsoDate(date)!.getUTCDay());
    });
    if (allowed.length === 0) continue;
    for (let ordinal = 1; ordinal <= target; ordinal += 1) {
      plans.push({
        key: `${seriesId}:week:${periodStart}:${ordinal}`,
        start: allowed[0],
        due: allowed.at(-1)!,
        ordinal
      });
    }
  }
  return plans;
}

export function weekRange(iso: string, weekStartsOn: WeekStart): { start: string; end: string } {
  const date = parseIsoDate(iso);
  if (!date) return { start: iso, end: iso };
  const startIndex = weekStartsOn === "sunday" ? 0 : weekStartsOn === "monday" ? 1 : 6;
  const offset = (date.getUTCDay() - startIndex + 7) % 7;
  const start = formatIsoDate(addUtcDays(date, -offset));
  return { start, end: shiftIsoDate(start, 6)! };
}

export function shiftIsoDate(iso: string | undefined, days: number): string | undefined {
  if (!iso) return undefined;
  const date = parseIsoDate(iso);
  return date ? formatIsoDate(addUtcDays(date, days)) : undefined;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return undefined;
  return date;
}

function datesBetweenInclusive(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = shiftIsoDate(cursor, 1) ?? "") dates.push(cursor);
  return dates;
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function formatIsoDate(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}
