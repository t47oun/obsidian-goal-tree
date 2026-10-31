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
  order: number;
}

const LIST_ITEM_MARKER = "goal-tree-list-item:";

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
  const lists = value.flatMap((entry, listIndex): GoalList[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<GoalList>;
    if (!candidate.id || !candidate.title || !Array.isArray(candidate.items)) return [];
    return [{
      id: candidate.id,
      title: candidate.title,
      createdAt: candidate.createdAt ?? localIsoDateTime(),
      order: Number.isFinite(candidate.order) ? Number(candidate.order) : listIndex,
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
  return DEFAULT_LIST_TITLES.map((title, order) => ({
    id: randomId("list"),
    title,
    items: [],
    createdAt: localIsoDateTime(),
    order
  }));
}

/**
 * Lists are stored as readable Markdown inside the vault so that uninstalling or
 * reinstalling the plugin cannot remove the user's list content.
 */
export function serializeGoalList(list: GoalList): string {
  const lines = [
    "---",
    "goal-tree-list: true",
    `list-id: ${JSON.stringify(list.id)}`,
    `list-title: ${JSON.stringify(singleLine(list.title))}`,
    `list-created: ${JSON.stringify(list.createdAt)}`,
    `list-order: ${list.order}`,
    "---",
    `# ${singleLine(list.title)}`,
    ""
  ];
  for (const item of list.items) {
    const marker = item.status === "finished" ? "x" : item.status === "in-progress" ? "/" : " ";
    const metadata = encodeURIComponent(JSON.stringify({
      id: item.id,
      url: item.url,
      notes: item.notes,
      linkedGoalId: item.linkedGoalId,
      completedAt: item.completedAt,
      createdAt: item.createdAt
    }));
    lines.push(`- [${marker}] ${singleLine(item.title)} <!-- ${LIST_ITEM_MARKER}${metadata} -->`);
  }
  lines.push("");
  return lines.join("\n");
}

export function parseGoalList(markdown: string, fallbackTitle = "List"): GoalList | undefined {
  if (!/^goal-tree-list:\s*true\s*$/m.test(markdown)) return undefined;
  const title = frontmatterText(markdown, "list-title") || headingTitle(markdown) || fallbackTitle;
  const id = frontmatterText(markdown, "list-id") || stableTextId("list", title);
  const createdAt = frontmatterText(markdown, "list-created") || localIsoDateTime();
  const parsedOrder = Number(frontmatterText(markdown, "list-order"));
  return { id, title, createdAt, order: Number.isFinite(parsedOrder) ? parsedOrder : Number.MAX_SAFE_INTEGER, items: parseListItems(markdown) };
}

export function reorderLists(
  lists: GoalList[],
  listId: string,
  targetListId: string,
  placeAfter = false
): GoalList[] {
  if (listId === targetListId) return lists.map((list) => ({ ...list }));
  const source = lists.find((list) => list.id === listId);
  if (!source || !lists.some((list) => list.id === targetListId)) return lists.map((list) => ({ ...list }));
  const reordered = lists.filter((list) => list.id !== listId);
  const targetIndex = reordered.findIndex((list) => list.id === targetListId);
  reordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
  return reordered.map((list, order) => ({ ...list, order }));
}

export function parseListItems(markdown: string): GoalListItem[] {
  const items: GoalListItem[] = [];
  const pattern = /^- \[([ xX/])\]\s+(.+?)(?:\s+<!-- goal-tree-list-item:([^\r\n]+) -->)?\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    try {
      const metadata = match[3]
        ? JSON.parse(decodeURIComponent(match[3])) as Partial<GoalListItem>
        : {};
      const title = match[2].trim();
      if (!title) continue;
      const status: ListItemStatus = match[1].toLowerCase() === "x"
        ? "finished"
        : match[1] === "/"
          ? "in-progress"
          : "not-finished";
      items.push({
        id: metadata.id || stableTextId("item", `${title}-${items.length}`),
        title,
        status,
        url: optionalString(metadata.url),
        notes: optionalString(metadata.notes),
        linkedGoalId: optionalString(metadata.linkedGoalId),
        completedAt: optionalString(metadata.completedAt),
        createdAt: optionalString(metadata.createdAt) || localIsoDateTime()
      });
    } catch {
      // Ignore malformed managed lines instead of making the entire list unreadable.
    }
  }
  return items;
}

export function listFileStem(title: string): string {
  const cleaned = singleLine(title)
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "List";
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
  const cryptoObject = typeof crypto === "undefined" ? undefined : crypto;
  const id = cryptoObject && typeof cryptoObject.randomUUID === "function"
    ? cryptoObject.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}

export function localIsoDateTime(date = new Date()): string {
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().replace(/Z$/, "");
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function headingTitle(markdown: string): string | undefined {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function frontmatterText(markdown: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const raw = markdown.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "m"))?.[1];
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string"
      ? optionalString(parsed)
      : typeof parsed === "number" || typeof parsed === "boolean"
        ? String(parsed)
        : undefined;
  } catch {
    return raw.replace(/^['"]|['"]$/g, "").trim() || undefined;
  }
}

function stableTextId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}
