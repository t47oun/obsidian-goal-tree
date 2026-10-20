import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoalForest,
  canParentType,
  childFolderForGoalPath,
  isActionableWorkItem,
  matchesCompletedDisplayMode,
  matchesKanbanDisplayMode,
  workHierarchyRoot
} from "../src/engine.ts";
import type { GoalInput } from "../src/engine.ts";

const TODAY = "2026-09-03";

function goal(overrides: Partial<GoalInput> & Pick<GoalInput, "id" | "title">): GoalInput {
  return {
    id: overrides.id,
    stableId: overrides.stableId ?? overrides.id,
    title: overrides.title,
    type: overrides.type ?? "goal",
    parentId: overrides.parentId,
    manualStatus: overrides.manualStatus ?? "not-started",
    severity: overrides.severity ?? "medium",
    start: overrides.start,
    scheduled: overrides.scheduled,
    due: overrides.due,
    completedAt: overrides.completedAt,
    recurrence: overrides.recurrence ?? "none",
    recurrenceInterval: overrides.recurrenceInterval ?? 1,
    archived: overrides.archived
  };
}

test("completion rolls through an unlimited one-child chain", () => {
  const forest = buildGoalForest([
    goal({ id: "religion", title: "Religion", type: "area" }),
    goal({ id: "quran", title: "Memorize the Quran", parentId: "religion" }),
    goal({ id: "tajweed", title: "Learn Tajweed", parentId: "quran", severity: "medium" }),
    goal({ id: "juz", title: "Memorize Juz Amma", parentId: "quran", severity: "medium" }),
    goal({ id: "book", title: "Read a Tajweed Book", parentId: "tajweed" }),
    goal({ id: "week", title: "Read 10 Pages This Week", parentId: "book" }),
    goal({
      id: "daily",
      title: "Read One Page Today",
      type: "subtask",
      parentId: "week",
      manualStatus: "completed",
      completedAt: "2026-09-03T08:00:00.000Z"
    })
  ], TODAY);

  const byId = new Map(forest.all.map((node) => [node.id, node]));
  assert.equal(byId.get("daily")?.metrics.progress, 100);
  assert.equal(byId.get("tajweed")?.metrics.progress, 100);
  assert.equal(byId.get("quran")?.metrics.progress, 50);
  assert.equal(byId.get("religion")?.metrics.progress, 50);
});

test("severity controls a child's direct influence", () => {
  const forest = buildGoalForest([
    goal({ id: "parent", title: "Parent" }),
    goal({ id: "small", title: "Small", parentId: "parent", severity: "low", manualStatus: "completed" }),
    goal({ id: "large", title: "Large", parentId: "parent", severity: "high" })
  ], TODAY);
  assert.equal(forest.roots[0].metrics.progress, 25);
  assert.equal(forest.roots[0].metrics.status, "in-progress");
});

test("an in-progress child makes every ancestor in progress even at zero percent", () => {
  const forest = buildGoalForest([
    goal({ id: "root", title: "Root" }),
    goal({ id: "middle", title: "Middle", parentId: "root" }),
    goal({ id: "leaf", title: "Leaf", parentId: "middle", manualStatus: "in-progress" })
  ], TODAY);
  const byId = new Map(forest.all.map((node) => [node.id, node]));
  assert.equal(byId.get("middle")?.metrics.status, "in-progress");
  assert.equal(byId.get("root")?.metrics.status, "in-progress");
});

test("an overdue descendant puts ancestors at risk", () => {
  const forest = buildGoalForest([
    goal({ id: "root", title: "Root" }),
    goal({ id: "child", title: "Child", parentId: "root" }),
    goal({ id: "late", title: "Late Task", parentId: "child", due: "2026-09-02" })
  ], TODAY);
  const byId = new Map(forest.all.map((node) => [node.id, node]));
  assert.equal(byId.get("late")?.metrics.health, "overdue");
  assert.equal(byId.get("child")?.metrics.health, "at-risk");
  assert.equal(byId.get("root")?.metrics.health, "at-risk");
});

test("an item is at risk when schedule progress is twenty points behind", () => {
  const forest = buildGoalForest([
    goal({ id: "project", title: "Project", type: "project", start: "2026-09-01", due: "2026-09-05" }),
    goal({ id: "task", title: "Task", type: "task", parentId: "project" })
  ], TODAY);
  assert.equal(forest.all.find((node) => node.id === "project")?.metrics.health, "at-risk");
});

test("life areas remain neutral even when a goal needs attention", () => {
  const forest = buildGoalForest([
    goal({ id: "area", title: "Work", type: "area" }),
    goal({ id: "goal", title: "Client delivery", parentId: "area" }),
    goal({ id: "late", title: "Late", parentId: "goal", due: "2026-09-01" })
  ], TODAY);
  assert.equal(forest.all.find((node) => node.id === "area")?.metrics.health, "on-track");
  assert.equal(forest.all.find((node) => node.id === "goal")?.metrics.health, "at-risk");
});

test("late completion propagates through a completed branch", () => {
  const forest = buildGoalForest([
    goal({ id: "root", title: "Root" }),
    goal({
      id: "leaf",
      title: "Leaf",
      parentId: "root",
      due: "2026-09-01",
      manualStatus: "completed",
      completedAt: "2026-09-02T08:00:00.000Z"
    })
  ], TODAY);
  const byId = new Map(forest.all.map((node) => [node.id, node]));
  assert.equal(byId.get("leaf")?.metrics.health, "completed-late");
  assert.equal(byId.get("root")?.metrics.status, "completed");
  assert.equal(byId.get("root")?.metrics.health, "completed-late");
});

test("cancelled children are excluded from roll-up", () => {
  const forest = buildGoalForest([
    goal({ id: "parent", title: "Parent" }),
    goal({ id: "done", title: "Done", parentId: "parent", manualStatus: "completed" }),
    goal({ id: "cancelled", title: "Cancelled", parentId: "parent", manualStatus: "cancelled", severity: "critical" })
  ], TODAY);
  assert.equal(forest.roots[0].metrics.progress, 100);
  assert.equal(forest.roots[0].metrics.status, "completed");
});

test("cycles are reported and do not recurse forever", () => {
  const forest = buildGoalForest([
    goal({ id: "a", title: "A", parentId: "b" }),
    goal({ id: "b", title: "B", parentId: "a" })
  ], TODAY);
  assert.equal(forest.roots.length, 2);
  assert.equal(forest.diagnostics.length, 2);
});

test("a child goal is stored in a companion folder under its parent", () => {
  assert.equal(
    childFolderForGoalPath("Goal Tree/Religion/Memorize the Quran.md"),
    "Goal Tree/Religion/Memorize the Quran"
  );
});

test("a life area stays ongoing and ignores its own completion and dates", () => {
  const forest = buildGoalForest([
    goal({
      id: "area",
      title: "Self Development",
      type: "area",
      manualStatus: "completed",
      start: "2026-01-01",
      due: "2026-01-02"
    }),
    goal({
      id: "goal",
      title: "Certify a SANS certificate",
      parentId: "area",
      manualStatus: "completed"
    })
  ], TODAY);
  const area = forest.all.find((node) => node.id === "area");
  assert.equal(area?.metrics.status, "ongoing");
  assert.equal(area?.metrics.progress, 100);
  assert.equal(area?.metrics.health, "on-track");
  assert.equal(area?.metrics.effectiveCompletedAt, undefined);
});

test("a life area severity-weights only its current direct goals and never becomes complete", () => {
  const forest = buildGoalForest([
    goal({ id: "area", title: "Work", type: "area" }),
    goal({ id: "done", title: "Done Goal", parentId: "area", severity: "low", manualStatus: "completed" }),
    goal({ id: "open", title: "Open Goal", parentId: "area", severity: "critical" }),
    goal({ id: "archived", title: "Archived Goal", parentId: "area", manualStatus: "completed", archived: true }),
    goal({ id: "cancelled", title: "Cancelled Goal", parentId: "area", manualStatus: "cancelled" })
  ], TODAY);
  const area = forest.all.find((node) => node.id === "area");
  assert.equal(area?.metrics.progress, 20);
  assert.equal(area?.metrics.status, "ongoing");
});

test("a life area with no current goals stays ongoing at zero progress", () => {
  const forest = buildGoalForest([
    goal({ id: "area", title: "Family", type: "area" }),
    goal({ id: "archived", title: "Past Goal", parentId: "area", manualStatus: "completed", archived: true })
  ], TODAY);
  const area = forest.all.find((node) => node.id === "area");
  assert.equal(area?.metrics.progress, 0);
  assert.equal(area?.metrics.status, "ongoing");
});

test("parent type rules enforce the intended hierarchy", () => {
  assert.equal(canParentType("area", "goal"), true);
  assert.equal(canParentType("goal", "goal"), true);
  assert.equal(canParentType("goal", "project"), true);
  assert.equal(canParentType("project", "task"), true);
  assert.equal(canParentType("task", "subtask"), true);
  assert.equal(canParentType("task", "goal"), false);
  assert.equal(canParentType("area", "subtask"), false);
});

test("only leaf work is actionable and nested subtasks resolve to their owning task", () => {
  const forest = buildGoalForest([
    goal({ id: "area", title: "Work", type: "area" }),
    goal({ id: "goal", title: "C-Unit Services", type: "goal", parentId: "area" }),
    goal({ id: "project", title: "FIB", type: "project", parentId: "goal" }),
    goal({ id: "task", title: "E-Statement MITRE Gap Assessment", type: "task", parentId: "project" }),
    goal({ id: "section", title: "Admin coordination", type: "subtask", parentId: "task" }),
    goal({ id: "meeting", title: "Meeting with E-Statement Admin", type: "subtask", parentId: "section" }),
    goal({ id: "standalone", title: "Standalone Task", type: "task", parentId: "project" })
  ], TODAY);
  const byId = new Map(forest.all.map((node) => [node.id, node]));
  const task = byId.get("task");
  const section = byId.get("section");
  const meeting = byId.get("meeting");
  const standalone = byId.get("standalone");
  assert.equal(task && isActionableWorkItem(task), false);
  assert.equal(section && isActionableWorkItem(section), false);
  assert.equal(meeting && isActionableWorkItem(meeting), true);
  assert.equal(standalone && isActionableWorkItem(standalone), true);
  assert.equal(meeting && workHierarchyRoot(meeting, forest.all).id, "task");
});

test("Kanban and Completed Work display modes select the requested hierarchy level", () => {
  const forest = buildGoalForest([
    goal({ id: "area", title: "Work", type: "area" }),
    goal({ id: "goal", title: "Service", type: "goal", parentId: "area" }),
    goal({ id: "project", title: "Assessment", type: "project", parentId: "goal" }),
    goal({ id: "task", title: "Review", type: "task", parentId: "project" }),
    goal({ id: "subtask", title: "Meeting", type: "subtask", parentId: "task" })
  ], TODAY);
  const byId = new Map(forest.all.map((node) => [node.id, node]));
  const project = byId.get("project")!;
  const task = byId.get("task")!;
  const subtask = byId.get("subtask")!;

  assert.equal(matchesKanbanDisplayMode(project, "project"), true);
  assert.equal(matchesKanbanDisplayMode(task, "task"), true);
  assert.equal(matchesKanbanDisplayMode(subtask, "subtask"), true);
  assert.equal(matchesKanbanDisplayMode(task, "hierarchy"), false);
  assert.equal(matchesKanbanDisplayMode(subtask, "hierarchy"), true);
  assert.equal(matchesCompletedDisplayMode(project, "hierarchy"), true);
  assert.equal(matchesCompletedDisplayMode(task, "hierarchy"), true);
  assert.equal(matchesCompletedDisplayMode(subtask, "hierarchy"), true);
  assert.equal(matchesCompletedDisplayMode(project, "task"), false);
});

test("all parent progress is severity based", () => {
  const forest = buildGoalForest([
    goal({ id: "parent", title: "Parent" }),
    goal({ id: "done", title: "Done", parentId: "parent", severity: "low", manualStatus: "completed" }),
    goal({ id: "open", title: "Open", parentId: "parent", severity: "critical" })
  ], TODAY);
  assert.equal(forest.roots[0].metrics.progress, 20);
});

test("a work leaf stays at zero progress until it is completed", () => {
  const forest = buildGoalForest([
    goal({ id: "task", title: "Task", type: "task", manualStatus: "in-progress" })
  ], TODAY);
  assert.equal(forest.roots[0].metrics.progress, 0);
  assert.equal(forest.roots[0].metrics.status, "in-progress");
});
