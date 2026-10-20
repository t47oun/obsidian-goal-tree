import assert from "node:assert/strict";
import test from "node:test";
import {
  daysBetween,
  nextRecurrenceDate,
  planRecurringOccurrences,
  shiftIsoDate,
  weekRange
} from "../src/recurrence.ts";

test("classic weekly recurrence honors the interval", () => {
  assert.equal(nextRecurrenceDate("2026-09-05", "weekly", 2), "2026-09-19");
});

test("daily recurrence creates every day in the current week", () => {
  const plans = planRecurringOccurrences(
    "daily",
    "daily",
    "2026-09-06",
    "2026-09-06",
    undefined,
    undefined,
    undefined,
    "sunday"
  );
  assert.deepEqual(plans.map((plan) => plan.scheduled), [
    "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"
  ]);
});

test("weekday recurrence means Sunday through Thursday", () => {
  const plans = planRecurringOccurrences(
    "workweek",
    "weekdays",
    "2026-09-06",
    "2026-09-06",
    undefined,
    undefined,
    undefined,
    "sunday"
  );
  assert.deepEqual(plans.map((plan) => plan.scheduled), [
    "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"
  ]);
});

test("monthly recurrence clamps to the last valid day", () => {
  assert.equal(nextRecurrenceDate("2026-01-31", "monthly", 1), "2026-02-28");
});

test("related dates can shift with the recurring occurrence", () => {
  assert.equal(daysBetween("2026-09-05", "2026-09-12"), 7);
  assert.equal(shiftIsoDate("2026-09-06", 7), "2026-09-13");
});

test("specific weekdays create dated occurrences only on selected days", () => {
  const plans = planRecurringOccurrences(
    "series",
    "specific-weekdays",
    "2026-09-06",
    "2026-09-06",
    undefined,
    [0, 1, 2, 3, 4],
    undefined,
    "sunday"
  );
  assert.deepEqual(plans.map((plan) => plan.scheduled), [
    "2026-09-06",
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
    "2026-09-10"
  ]);
  assert.equal(new Set(plans.map((plan) => plan.key)).size, 5);
});

test("weekly target creates flexible numbered occurrences inside the allowed window", () => {
  const plans = planRecurringOccurrences(
    "gym",
    "weekly-target",
    "2026-09-06",
    "2026-09-06",
    undefined,
    [0, 1, 2, 3, 4],
    2,
    "sunday"
  );
  assert.deepEqual(plans, [
    { key: "gym:week:2026-09-06:1", start: "2026-09-06", due: "2026-09-10", ordinal: 1 },
    { key: "gym:week:2026-09-06:2", start: "2026-09-06", due: "2026-09-10", ordinal: 2 }
  ]);
});

test("series end prevents generated occurrences after the final date", () => {
  const plans = planRecurringOccurrences(
    "study",
    "specific-weekdays",
    "2026-09-06",
    "2026-09-06",
    "2026-09-08",
    [0, 1, 2, 3, 4],
    undefined,
    "sunday"
  );
  assert.deepEqual(plans.map((plan) => plan.scheduled), ["2026-09-06", "2026-09-07", "2026-09-08"]);
});

test("week range follows the configured first day", () => {
  assert.deepEqual(weekRange("2026-09-09", "sunday"), { start: "2026-09-06", end: "2026-09-12" });
  assert.deepEqual(weekRange("2026-09-09", "saturday"), { start: "2026-09-05", end: "2026-09-11" });
});

test("a series starting after its selected days begins on the following week", () => {
  const plans = planRecurringOccurrences(
    "future",
    "specific-weekdays",
    "2026-09-11",
    "2026-09-11",
    undefined,
    [0, 1, 2, 3, 4],
    undefined,
    "sunday",
    1
  );
  assert.equal(plans[0]?.scheduled, "2026-09-13");
});
