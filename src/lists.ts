export type ListItemStatus = "not-finished" | "in-progress" | "finished";

export interface GoalListItem {
  id: string;
  title: string;
  status: ListItemStatus;
  url?: string;
  notes?: string;
  linkedGoalId?: string;
  completedAt?: string;
  createdAt: string;
}

export interface GoalList {
  id: string;
  title: string;
  items: GoalListItem[];
  createdAt: string;
}

export const DEFAULT_LIST_TITLES = [
  "Movies",
  "Technical Books",
  "Books",
  "Courses",
  "Certifications",
  "Articles",
  "People of Interest",
  "Documentaries",
  "Podcasts"
] as const;

export function normalizeLists(value: unknown): GoalList[] {
  if (!Array.isArray(value)) return createDefaultLists();
  const lists = value.flatMap((entry): GoalList[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<GoalList>;
    if (!candidate.id || !candidate.title || !Array.isArray(candidate.items)) return [];
    return [{
      id: candidate.id,
      title: candidate.title,
      createdAt: candidate.createdAt ?? localIsoDateTime(),
      items: candidate.items.flatMap((item): GoalListItem[] => {
        if (!item || typeof item !== "object") return [];
        const current = item as Partial<GoalListItem>;
        if (!current.id || !current.title) return [];
        const status: ListItemStatus = current.status === "finished"
          ? "finished"
          : current.status === "in-progress"
            ? "in-progress"
            : "not-finished";
        return [{
          id: current.id,
          title: current.title,
          status,
          url: current.url,
          notes: current.notes,
          linkedGoalId: current.linkedGoalId,
          completedAt: current.completedAt,
          createdAt: current.createdAt ?? localIsoDateTime()
        }];
      })
    }];
  });
  return lists.length > 0 ? lists : createDefaultLists();
}

export function createDefaultLists(): GoalList[] {
  return DEFAULT_LIST_TITLES.map((title) => ({
    id: randomId("list"),
    title,
    items: [],
    createdAt: localIsoDateTime()
  }));
}

export function sortedListItems(
  items: GoalListItem[],
  finishedOrder: "manual" | "newest" | "oldest" = "manual"
): GoalListItem[] {
  const active = items.filter((item) => item.status !== "finished");
  const finished = items.filter((item) => item.status === "finished");
  if (finishedOrder !== "manual") {
    finished.sort((left, right) => {
      const comparison = (left.completedAt ?? left.createdAt).localeCompare(right.completedAt ?? right.createdAt);
      return finishedOrder === "newest" ? -comparison : comparison;
    });
  }
  return [...active, ...finished];
}

export function reorderListItems(
  items: GoalListItem[],
  itemId: string,
  targetItemId: string,
  placeAfter = false
): GoalListItem[] {
  if (itemId === targetItemId) return [...items];
  const source = items.find((item) => item.id === itemId);
  const target = items.find((item) => item.id === targetItemId);
  if (!source || !target) return [...items];
  if ((source.status === "finished") !== (target.status === "finished")) return [...items];

  const reordered = items.filter((item) => item.id !== itemId);
  const targetIndex = reordered.findIndex((item) => item.id === targetItemId);
  if (targetIndex < 0) return [...items];
  reordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
  return reordered;
}

export function randomId(prefix: string): string {
  const cryptoObject = globalThis.crypto;
  const id = cryptoObject && typeof cryptoObject.randomUUID === "function"
    ? cryptoObject.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}

export function localIsoDateTime(date = new Date()): string {
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().replace(/Z$/, "");
}
