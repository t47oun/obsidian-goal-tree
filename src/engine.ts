export type GoalType = "area" | "goal" | "project" | "task" | "subtask";

export type GoalSeverity = "low" | "medium" | "high" | "critical";

export type RecurrenceRule =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "specific-weekdays"
  | "weekly-target";

export type ManualStatus = "not-started" | "in-progress" | "completed" | "cancelled";

export type CalculatedStatus = ManualStatus | "ongoing";

export type WorkDisplayMode = "hierarchy" | "project" | "task" | "subtask";

export type KanbanScope = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export type GoalHealth =
  | "on-track"
  | "at-risk"
  | "overdue"
  | "completed-on-time"
  | "completed-late"
  | "cancelled";

export interface GoalInput {
  /** Current Markdown path. */
  id: string;
  /** Permanent identity stored in goal-id. */
  stableId: string;
  title: string;
  /** Short note shown and edited inside Goal Tree. The Markdown note remains the full record. */
  notes?: string;
  type: GoalType;
  parentId?: string;
  manualStatus: ManualStatus;
  severity: GoalSeverity;
  start?: string;
  scheduled?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  plannedMinutes?: number;
  /** A Task/Subtask scheduled as a meeting rather than independent work. */
  isMeeting?: boolean;
  due?: string;
  completedAt?: string;
  createdAt?: string;
  recurrence: RecurrenceRule;
  recurrenceInterval: number;
  /** Selected JavaScript weekday numbers (Sunday = 0). */
  recurrenceWeekdays?: number[];
  /** Number of flexible occurrences required in each week. */
  recurrenceTarget?: number;
  /** Effective dates for the recurring series, independent of occurrence dates. */
  recurrenceStart?: string;
  recurrenceEnd?: string;
  /** Stable generated-occurrence identity used to prevent duplicates. */
  recurrenceKey?: string;
  recurrenceOrdinal?: number;
  seriesId?: string;
  archived?: boolean;
  /** Stable user-defined ordering used by Tree and Kanban. */
  order?: number;
}

export interface GoalMetrics {
  progress: number;
  status: CalculatedStatus;
  health: GoalHealth;
  effectiveCompletedAt?: string;
  lateInBranch: boolean;
  overdueInBranch: boolean;
}

export interface GoalNode extends GoalInput {
  children: GoalNode[];
  metrics: GoalMetrics;
}

export interface GoalForest {
  roots: GoalNode[];
  all: GoalNode[];
  diagnostics: string[];
}

const TYPE_ORDER: Record<GoalType, number> = {
  area: 0,
  goal: 1,
  project: 2,
  task: 3,
  subtask: 4
};

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeSeverity(value: unknown): GoalSeverity {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") {
    return normalized;
  }
  return "medium";
}

export function normalizeRecurrence(value: unknown): RecurrenceRule {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "daily" ||
    normalized === "weekdays" ||
    normalized === "weekly" ||
    normalized === "monthly" ||
    normalized === "specific-weekdays" ||
    normalized === "weekly-target"
  ) {
    return normalized;
  }
  return "none";
}

export function severityFromLegacyWeight(value: number): GoalSeverity {
  if (!Number.isFinite(value)) return "medium";
  if (value <= 1) return "low";
  if (value <= 2) return "medium";
  if (value <= 3) return "high";
  return "critical";
}

export function severityScore(severity: GoalSeverity): number {
  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

export function buildGoalForest(inputs: GoalInput[], today: string): GoalForest {
  const diagnostics: string[] = [];
  const inputById = new Map(inputs.map((input) => [input.id, input]));
  const nodes = inputs.map<GoalNode>((input) => ({
    ...input,
    severity: normalizeSeverity(input.severity),
    recurrence: normalizeRecurrence(input.recurrence),
    recurrenceInterval: normalizePositiveInteger(input.recurrenceInterval, 1),
    recurrenceWeekdays: normalizeWeekdayNumbers(input.recurrenceWeekdays),
    recurrenceTarget: input.recurrenceTarget === undefined
      ? undefined
      : normalizePositiveInteger(input.recurrenceTarget, 1),
    plannedMinutes: input.plannedMinutes === undefined
      ? undefined
      : normalizePositiveInteger(input.plannedMinutes, 1),
    children: [],
    metrics: emptyMetrics()
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const stableIds = new Set<string>();
  const roots: GoalNode[] = [];

  for (const node of nodes) {
    if (stableIds.has(node.stableId)) diagnostics.push(`Duplicate goal-id found for "${node.title}".`);
    stableIds.add(node.stableId);
    if (!node.parentId) {
      if (node.type !== "area") diagnostics.push(`"${node.title}" needs a valid parent.`);
      roots.push(node);
      continue;
    }

    const parent = nodeById.get(node.parentId);
    if (!parent) {
      diagnostics.push(`Missing parent for "${node.title}".`);
      roots.push(node);
      continue;
    }

    if (createsCycle(node.id, node.parentId, inputById)) {
      diagnostics.push(`Circular parent link detected for "${node.title}".`);
      roots.push(node);
      continue;
    }

    if (!canParentType(parent.type, node.type)) {
      diagnostics.push(`Invalid ${parent.type} → ${node.type} link for "${node.title}".`);
    }
    parent.children.push(node);
  }

  sortNodes(roots);
  for (const root of roots) computeMetrics(root, today);

  return { roots, all: nodes, diagnostics };
}

/** Collection summaries stay severity-aware so urgent branches remain visible. */
export function collectionProgress(nodes: GoalNode[]): number {
  return severityWeightedProgress(nodes);
}

export function activeChildren(node: GoalNode): GoalNode[] {
  return node.children.filter((child) => child.metrics.status !== "cancelled");
}

export function isLeaf(node: GoalNode): boolean {
  return activeChildren(node).length === 0;
}

export function isWorkItem(node: GoalNode): boolean {
  return node.type === "task" || node.type === "subtask";
}

/** A work item is directly actionable only while it has no active work children. */
export function isActionableWorkItem(node: GoalNode): boolean {
  return isWorkItem(node) && isLeaf(node);
}

export function matchesKanbanDisplayMode(node: GoalNode, mode: WorkDisplayMode): boolean {
  return mode === "hierarchy" ? isActionableWorkItem(node) : node.type === mode;
}

export function matchesCompletedDisplayMode(node: GoalNode, mode: WorkDisplayMode): boolean {
  if (mode !== "hierarchy") return node.type === mode;
  return node.type === "project" || node.type === "task" || node.type === "subtask";
}

/** Returns the highest Task/Subtask ancestor that owns this executable branch. */
export function workHierarchyRoot(node: GoalNode, nodes: GoalNode[]): GoalNode {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const visited = new Set<string>([node.stableId]);
  let root = node;
  let parent = root.parentId ? byId.get(root.parentId) : undefined;
  while (parent && isWorkItem(parent) && !visited.has(parent.stableId)) {
    visited.add(parent.stableId);
    root = parent;
    parent = root.parentId ? byId.get(root.parentId) : undefined;
  }
  return root;
}

export function canParentType(parentType: GoalType, childType: GoalType): boolean {
  if (childType === "area") return false;
  if (childType === "goal") return parentType === "area" || parentType === "goal";
  if (childType === "project") return parentType === "goal";
  if (childType === "task") return parentType === "project";
  return parentType === "task" || parentType === "subtask";
}

export function childFolderForGoalPath(parentPath: string): string {
  return parentPath.replace(/\.md$/i, "");
}

function emptyMetrics(): GoalMetrics {
  return {
    progress: 0,
    status: "not-started",
    health: "on-track",
    lateInBranch: false,
    overdueInBranch: false
  };
}

function createsCycle(id: string, parentId: string, inputById: Map<string, GoalInput>): boolean {
  const visited = new Set<string>([id]);
  let cursor: string | undefined = parentId;

  while (cursor) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = inputById.get(cursor)?.parentId;
  }

  return false;
}

function sortNodes(nodes: GoalNode[]): void {
  nodes.sort((a, b) => {
    const aOrder = Number.isFinite(a.order) ? a.order as number : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(b.order) ? b.order as number : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const typeDifference = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
    if (typeDifference !== 0) return typeDifference;
    const aDate = a.scheduled ?? a.due;
    const bDate = b.scheduled ?? b.due;
    if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return a.title.localeCompare(b.title);
  });
  for (const node of nodes) sortNodes(node.children);
}

function computeMetrics(node: GoalNode, today: string): GoalMetrics {
  const childMetrics = node.children.map((child) => computeMetrics(child, today));

  if (node.type === "area") {
    const currentGoals = node.children.filter(
      (child) => child.type === "goal" && child.metrics.status !== "cancelled" && !child.archived
    );
    const childLate = currentGoals.some((child) => child.metrics.lateInBranch);
    const childOverdue = currentGoals.some((child) => child.metrics.overdueInBranch);
    node.metrics = {
      progress: currentGoals.length > 0 ? severityWeightedProgress(currentGoals) : 0,
      status: "ongoing",
      health: "on-track",
      lateInBranch: childLate,
      overdueInBranch: childOverdue
    };
    return node.metrics;
  }

  if (node.manualStatus === "cancelled") {
    node.metrics = {
      progress: 0,
      status: "cancelled",
      health: "cancelled",
      lateInBranch: false,
      overdueInBranch: false
    };
    return node.metrics;
  }

  const active = node.children.filter((child) => child.metrics.status !== "cancelled");
  const progress = calculateNodeProgress(node, active);
  const status = calculateStatus(node, active, progress);
  const effectiveCompletedAt = status === "completed"
    ? latestDateTime([
        node.completedAt,
        ...active.map((child) => child.metrics.effectiveCompletedAt)
      ]) ?? `${today}T00:00:00`
    : undefined;
  const ownCompletedLate = Boolean(
    node.due && effectiveCompletedAt && datePart(effectiveCompletedAt) > node.due
  );
  const childLate = childMetrics.some((metrics) => metrics.lateInBranch);
  const lateInBranch = ownCompletedLate || childLate;
  const ownOverdue = status !== "completed" && Boolean(node.due && node.due < today);
  const childOverdue = childMetrics.some((metrics) => metrics.overdueInBranch);
  const overdueInBranch = ownOverdue || childOverdue;
  const expectedProgress = expectedProgressForDateRange(node.start, node.due, today);
  const progressBehindSchedule = expectedProgress !== undefined && expectedProgress - progress >= 20;

  let health: GoalHealth;
  if (status === "completed") health = lateInBranch ? "completed-late" : "completed-on-time";
  else if (ownOverdue) health = "overdue";
  else if (progressBehindSchedule || childOverdue || childLate) health = "at-risk";
  else health = "on-track";

  node.metrics = {
    progress,
    status,
    health,
    effectiveCompletedAt,
    lateInBranch,
    overdueInBranch
  };
  return node.metrics;
}

function expectedProgressForDateRange(start: string | undefined, due: string | undefined, today: string): number | undefined {
  if (!start || !due || due <= start || today <= start) return undefined;
  if (today >= due) return 100;
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const dueTime = Date.parse(`${due}T00:00:00Z`);
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  if (![startTime, dueTime, todayTime].every(Number.isFinite)) return undefined;
  return clampProgress(((todayTime - startTime) / (dueTime - startTime)) * 100);
}

function calculateNodeProgress(node: GoalNode, children: GoalNode[]): number {
  if (node.manualStatus === "completed") return 100;
  if (children.length > 0) return severityWeightedProgress(children);
  return leafProgress(node.manualStatus);
}

function calculateStatus(node: GoalNode, children: GoalNode[], progress: number): ManualStatus {
  if (node.manualStatus === "completed") return "completed";
  if (progress >= 100 && (children.length > 0 || !isWorkItem(node))) return "completed";
  if (node.manualStatus === "in-progress" || progress > 0 || children.some((child) => child.metrics.status === "in-progress")) {
    return "in-progress";
  }
  return "not-started";
}

function severityWeightedProgress(nodes: GoalNode[]): number {
  const active = nodes.filter((node) => node.metrics.status !== "cancelled");
  if (active.length === 0) return 0;
  const totalWeight = active.reduce((sum, node) => sum + severityScore(node.severity), 0);
  const weighted = active.reduce((sum, node) => sum + node.metrics.progress * severityScore(node.severity), 0);
  return clampProgress(weighted / totalWeight);
}

function leafProgress(status: ManualStatus): number {
  if (status === "completed") return 100;
  return 0;
}

function latestDateTime(values: Array<string | undefined>): string | undefined {
  const available = values.filter((value): value is string => Boolean(value));
  if (available.length === 0) return undefined;
  return available.sort((a, b) => a.localeCompare(b)).at(-1);
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) < 1) return fallback;
  return Math.max(1, Math.round(value ?? fallback));
}

function normalizeWeekdayNumbers(values: number[] | undefined): number[] | undefined {
  if (!values) return undefined;
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))]
    .sort((a, b) => a - b);
}
