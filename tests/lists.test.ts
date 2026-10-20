import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultLists, normalizeLists, reorderListItems, sortedListItems } from "../src/lists.ts";

test("default personal lists are created for a new installation", () => {
  const titles = createDefaultLists().map((list) => list.title);
  assert.deepEqual(titles, ["Movies", "Technical Books", "Books", "Courses", "Certifications", "Articles"]);
});

test("finished list items move below active items while manual order is preserved", () => {
  const items = sortedListItems([
    { id: "old", title: "Old", status: "finished", completedAt: "2026-09-01", createdAt: "2026-01-01" },
    { id: "todo", title: "Todo", status: "not-finished", createdAt: "2026-01-02" },
    { id: "doing", title: "Doing", status: "in-progress", createdAt: "2026-01-03" },
    { id: "new", title: "New", status: "finished", completedAt: "2026-09-30", createdAt: "2026-01-04" }
  ]);
  assert.deepEqual(items.map((item) => item.id), ["todo", "doing", "old", "new"]);
});

test("list items can be reordered inside the active section", () => {
  const items = [
    { id: "first", title: "First", status: "not-finished" as const, createdAt: "2026-01-01" },
    { id: "second", title: "Second", status: "in-progress" as const, createdAt: "2026-01-02" },
    { id: "done", title: "Done", status: "finished" as const, createdAt: "2026-01-03" }
  ];
  const reordered = reorderListItems(items, "second", "first");
  assert.deepEqual(sortedListItems(reordered).map((item) => item.id), ["second", "first", "done"]);
});

test("dragging cannot move an active item into the finished section", () => {
  const items = [
    { id: "active", title: "Active", status: "not-finished" as const, createdAt: "2026-01-01" },
    { id: "done", title: "Done", status: "finished" as const, createdAt: "2026-01-02" }
  ];
  assert.deepEqual(reorderListItems(items, "active", "done"), items);
});

test("invalid saved list data falls back to the starter lists", () => {
  assert.equal(normalizeLists({ invalid: true }).length, 6);
});
