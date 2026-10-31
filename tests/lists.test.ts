import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultLists,
  normalizeLists,
  parseGoalList,
  parseListItems,
  reorderLists,
  reorderListItems,
  serializeGoalList,
  sortedListItems
} from "../src/lists.ts";

test("default personal lists are created for a new installation", () => {
  const titles = createDefaultLists().map((list) => list.title);
  assert.deepEqual(titles, [
    "Movies", "Technical Books", "Books", "Courses", "Certifications", "Articles",
    "People of Interest", "Documentaries", "Podcasts"
  ]);
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

test("finished items support newest and oldest completion ordering", () => {
  const items = [
    { id: "older", title: "Older", status: "finished" as const, completedAt: "2026-09-01", createdAt: "2026-01-01" },
    { id: "active", title: "Active", status: "not-finished" as const, createdAt: "2026-01-02" },
    { id: "newer", title: "Newer", status: "finished" as const, completedAt: "2026-09-30", createdAt: "2026-01-03" }
  ];
  assert.deepEqual(sortedListItems(items, "newest").map((item) => item.id), ["active", "newer", "older"]);
  assert.deepEqual(sortedListItems(items, "oldest").map((item) => item.id), ["active", "older", "newer"]);
});

test("invalid saved list data falls back to the starter lists", () => {
  assert.equal(normalizeLists({ invalid: true }).length, 9);
});

test("list Markdown round-trips ids, statuses, notes, links, and manual order", () => {
  const list = {
    id: "list-movies",
    title: "Movies & Series",
    createdAt: "2026-10-30T10:00:00.000",
    order: 3,
    items: [
      {
        id: "item-one",
        title: "Arrival",
        status: "in-progress" as const,
        url: "https://example.com/arrival",
        notes: "Continue this weekend",
        linkedGoalId: "goal-arrival",
        createdAt: "2026-10-30T10:01:00.000"
      },
      {
        id: "item-two",
        title: "Heat",
        status: "finished" as const,
        completedAt: "2026-10-30T20:00:00.000",
        createdAt: "2026-10-30T10:02:00.000"
      }
    ]
  };
  assert.deepEqual(parseGoalList(serializeGoalList(list)), normalizeLists([list])[0]);
});

test("list categories can be reordered without changing their items", () => {
  const lists = createDefaultLists().slice(0, 3);
  const firstItem = {
    id: "arrival",
    title: "Arrival",
    status: "not-finished" as const,
    createdAt: "2026-10-30T10:01:00.000"
  };
  lists[0].items.push(firstItem);
  const reordered = reorderLists(lists, lists[2].id, lists[0].id);
  assert.deepEqual(reordered.map((list) => list.title), ["Books", "Movies", "Technical Books"]);
  assert.deepEqual(reordered.map((list) => list.order), [0, 1, 2]);
  assert.deepEqual(reordered[1].items, [firstItem]);
});

test("older list Markdown remains readable when it has no list-order field", () => {
  const legacy = [
    "---",
    "goal-tree-list: true",
    "list-id: \"legacy\"",
    "list-title: \"Movies\"",
    "list-created: \"2026-10-20T10:00:00.000\"",
    "---",
    "# Movies",
    "",
    "- [ ] Existing movie",
    ""
  ].join("\n");
  const parsed = parseGoalList(legacy);
  assert.equal(parsed?.order, Number.MAX_SAFE_INTEGER);
  assert.equal(parsed?.items[0]?.title, "Existing movie");
});

test("plain Markdown checkboxes added by the user are imported", () => {
  const items = parseListItems("- [ ] Read one article\n- [/] Course in progress\n- [x] Finished book\n");
  assert.deepEqual(items.map((item) => [item.title, item.status]), [
    ["Read one article", "not-finished"],
    ["Course in progress", "in-progress"],
    ["Finished book", "finished"]
  ]);
});
