import { Notice, Plugin } from "obsidian";
import {
  canParentType,
  GoalForest,
  GoalNode,
  ManualStatus,
  normalizeSeverity,
  severityFromLegacyWeight
} from "./engine";
import {
  EditGoalInput,
  GoalRepository,
  GoalTreeSettings,
  NewGoalInput
} from "./repository";
import {
  GoalList,
  GoalListItem,
  ListItemStatus,
  localIsoDateTime as listIsoDateTime,
  normalizeLists,
  reorderListItems,
  randomId as listRandomId
} from "./lists";
import { GoalTreeSettingTab } from "./settings";
import {
  GoalTreeHost,
  GoalTreeTab,
  GoalTreeView,
  todayIso,
  VIEW_TYPE_GOAL_TREE
} from "./ui";

const DEFAULT_SETTINGS: GoalTreeSettings = {
  goalsFolder: "Goal Tree",
  defaultSeverity: "medium",
  syncCalculatedProperties: true,
  todayIncludeAvailable: true,
  weekStartsOn: "sunday",
  kanbanDefaultScope: "weekly",
  kanbanDefaultDisplay: "hierarchy",
  kanbanShowCompleted: true,
  kanbanShowUnscheduled: false,
  kanbanShowParentPath: true,
  kanbanShowSeverity: true,
  kanbanShowTime: true,
  kanbanShowDueDate: true
};

interface StoredData extends Partial<GoalTreeSettings> {
  defaultWeight?: number;
  defaultProgressMode?: unknown;
  pomodoroState?: unknown;
  workTimerState?: unknown;
  focusSessions?: unknown;
  lists?: GoalList[];
}

export default class GoalTreePlugin extends Plugin implements GoalTreeHost {
  settings: GoalTreeSettings = { ...DEFAULT_SETTINGS };
  private repository!: GoalRepository;
  private refreshTimer?: number;
  private refreshing = false;
  private refreshAgain = false;
  private lists: GoalList[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    this.repository = new GoalRepository(this.app, () => this.settings);

    this.registerView(VIEW_TYPE_GOAL_TREE, (leaf) => new GoalTreeView(leaf, this));
    this.addRibbonIcon("network", "Open Goal Tree", () => void this.activateView());
    this.addSettingTab(new GoalTreeSettingTab(this.app, this));

    this.addCommand({ id: "open-goal-tree", name: "Open overview", callback: () => void this.activateView("overview") });
    this.addCommand({ id: "open-goal-today", name: "Open Today", callback: () => void this.activateView("today") });
    this.addCommand({ id: "open-goal-plan", name: "Open goal hierarchy", callback: () => void this.activateView("tree") });
    this.addCommand({ id: "open-goal-calendar", name: "Open calendar", callback: () => void this.activateView("calendar") });
    this.addCommand({ id: "open-goal-kanban", name: "Open kanban", callback: () => void this.activateView("kanban") });
    this.addCommand({ id: "open-goal-graph", name: "Open graph", callback: () => void this.activateView("graph") });
    this.addCommand({ id: "open-goal-lists", name: "Open lists", callback: () => void this.activateView("lists") });
    this.addCommand({ id: "open-completed-work", name: "Open Review", callback: () => void this.activateView("review") });
    this.addCommand({
      id: "add-goal-item",
      name: "Add goal item",
      callback: () => void this.activateView().then(() => new Notice("Use Add item in the Goal Tree dashboard."))
    });
    this.addCommand({ id: "create-starter-goal-tree", name: "Create starter goal tree", callback: () => void this.createStarterTree() });
    this.addCommand({ id: "organize-goal-files", name: "Organize files into goal hierarchy", callback: () => void this.organizeGoalFiles() });
    this.addCommand({ id: "repair-goal-hierarchy", name: "Repair goal properties and identities", callback: () => void this.repairGoalHierarchy() });

    const queue = (): void => this.queueRefresh();
    this.registerEvent(this.app.metadataCache.on("changed", queue));
    this.registerEvent(this.app.vault.on("create", queue));
    this.registerEvent(this.app.vault.on("delete", queue));
    this.registerEvent(this.app.vault.on("rename", queue));
    this.app.workspace.onLayoutReady(() => this.queueRefresh(0));
  }

  onunload(): void {
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    void this.persistData();
  }

  async saveSettings(): Promise<void> {
    await this.persistData();
  }

  loadSnapshot(): GoalForest {
    return this.repository.load(todayIso());
  }

  getLists(): GoalList[] {
    return this.lists.map((list) => ({ ...list, items: list.items.map((item) => ({ ...item })) }));
  }

  async createList(title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Enter a list name.");
    if (this.lists.some((list) => list.title.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("A list with this name already exists.");
    }
    this.lists.push({ id: listRandomId("list"), title: trimmed, items: [], createdAt: listIsoDateTime() });
    await this.persistData();
    await this.refreshAll();
  }

  async deleteList(listId: string): Promise<void> {
    this.lists = this.lists.filter((list) => list.id !== listId);
    await this.persistData();
    await this.refreshAll();
  }

  async createListItem(listId: string, title: string, url?: string, notes?: string): Promise<void> {
    const list = this.lists.find((candidate) => candidate.id === listId);
    if (!list) throw new Error("List not found.");
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Enter an item title.");
    list.items.push({
      id: listRandomId("item"),
      title: trimmed,
      status: "not-finished",
      url: url?.trim() || undefined,
      notes: notes?.trim() || undefined,
      createdAt: listIsoDateTime()
    });
    await this.persistData();
    await this.refreshAll();
  }

  async updateListItem(listId: string, itemId: string, title: string, url?: string, notes?: string): Promise<void> {
    const item = this.listItem(listId, itemId);
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Enter an item title.");
    item.title = trimmed;
    item.url = url?.trim() || undefined;
    item.notes = notes?.trim() || undefined;
    await this.persistData();
    await this.refreshAll();
  }

  async setListItemStatus(listId: string, itemId: string, status: ListItemStatus): Promise<void> {
    const list = this.lists.find((candidate) => candidate.id === listId);
    if (!list) throw new Error("List not found.");
    const item = this.listItem(listId, itemId);
    item.status = status;
    item.completedAt = status === "finished" ? listIsoDateTime() : undefined;
    list.items = [
      ...list.items.filter((candidate) => candidate.status !== "finished"),
      ...list.items.filter((candidate) => candidate.status === "finished")
    ];
    if (item.linkedGoalId) {
      const node = this.loadSnapshot().all.find((candidate) => candidate.stableId === item.linkedGoalId);
      if (node && node.type !== "area") {
        await this.setGoalStatus(node, status === "finished" ? "completed" : status === "in-progress" ? "in-progress" : "not-started");
        return;
      }
    }
    await this.persistData();
    await this.refreshAll();
  }

  async reorderListItem(listId: string, itemId: string, targetItemId: string, placeAfter = false): Promise<void> {
    const list = this.lists.find((candidate) => candidate.id === listId);
    if (!list) throw new Error("List not found.");
    list.items = reorderListItems(list.items, itemId, targetItemId, placeAfter);
    await this.persistData();
    await this.refreshAll();
  }

  async deleteListItem(listId: string, itemId: string): Promise<void> {
    const list = this.lists.find((candidate) => candidate.id === listId);
    if (!list) return;
    list.items = list.items.filter((item) => item.id !== itemId);
    await this.persistData();
    await this.refreshAll();
  }

  async createGoalFromList(listId: string, itemId: string, input: NewGoalInput): Promise<void> {
    this.validateGoalFields(input);
    const file = await this.repository.create(input);
    const node = await this.waitForCreatedGoal(file.path);
    if (!node) throw new Error("The created Goal Tree item could not be linked.");
    const item = this.listItem(listId, itemId);
    item.linkedGoalId = node.stableId;
    await this.persistData();
    await this.refreshAll();
    new Notice(`Added “${item.title}” to Goal Tree.`);
  }

  private async waitForCreatedGoal(path: string, timeoutMs = 5_000): Promise<GoalNode | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const node = this.repository.load(todayIso()).all.find((candidate) => candidate.id === path);
      if (node) return node;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    return this.repository.load(todayIso()).all.find((candidate) => candidate.id === path);
  }

  async unlinkListItem(listId: string, itemId: string): Promise<void> {
    const item = this.listItem(listId, itemId);
    delete item.linkedGoalId;
    await this.persistData();
    await this.refreshAll();
  }

  async refreshAll(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }

    this.refreshing = true;
    try {
      const forest = this.loadSnapshot();
      const generated = await this.repository.ensureRecurringOccurrences(forest, todayIso());
      if (generated > 0) this.refreshAgain = true;
      if (this.settings.syncCalculatedProperties) await this.repository.syncCalculatedProperties(forest);
      else await this.repository.ensureIdentities(forest);
      if (this.syncListLinks(forest)) await this.persistData();
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GOAL_TREE)) {
        if (leaf.view instanceof GoalTreeView) await leaf.view.render(forest);
      }
    } finally {
      this.refreshing = false;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        this.queueRefresh(50);
      }
    }
  }

  async createGoal(input: NewGoalInput): Promise<void> {
    this.validateGoalFields(input);
    await this.repository.create(input);
    await this.refreshAll();
    new Notice(`Created “${input.title}”.`);
  }

  async updateGoal(node: GoalNode, input: EditGoalInput): Promise<void> {
    this.validateGoalFields(input, node);
    if (node.children.some((child) => !canParentType(input.type, child.type))) {
      throw new Error("This type cannot contain one or more existing children.");
    }
    await this.repository.update(node, input);
    await this.refreshAll();
    new Notice(`Updated “${input.title}”.`);
  }

  async duplicateGoal(node: GoalNode): Promise<void> {
    await this.repository.duplicate(node);
    await this.refreshAll();
    new Notice(`Duplicated “${node.title}”.`);
  }

  async deleteGoal(node: GoalNode, deleteSeries = false): Promise<void> {
    const forest = this.loadSnapshot();
    const targets = new Map<string, GoalNode>();
    const addBranch = (current: GoalNode): void => {
      if (targets.has(current.stableId)) return;
      targets.set(current.stableId, current);
      for (const child of current.children) addBranch(child);
    };
    if (deleteSeries && node.seriesId) {
      for (const member of forest.all.filter((candidate) => candidate.seriesId === node.seriesId)) addBranch(member);
    } else {
      const current = forest.all.find((candidate) => candidate.stableId === node.stableId) ?? node;
      addBranch(current);
    }

    const deleted = await this.repository.deleteNodes([...targets.values()]);
    await this.persistData();
    await this.refreshAll();
    new Notice(`Moved ${deleted} item${deleted === 1 ? "" : "s"} to Obsidian trash.`);
  }

  async reparentGoal(node: GoalNode, parent: GoalNode): Promise<void> {
    if (!canParentType(parent.type, node.type)) {
      new Notice(`A ${node.type} cannot be placed under a ${parent.type}.`);
      return;
    }
    if (node.stableId === parent.stableId || this.isDescendant(parent, node)) {
      new Notice("That move would create a circular hierarchy.");
      return;
    }
    await this.repository.reparent(node, parent);
    await this.refreshAll();
    new Notice(`Moved “${node.title}” under “${parent.title}”. Run Organize files when you also want to move its note.`);
  }

  async scheduleGoal(node: GoalNode, scheduled: string): Promise<void> {
    if (!isActionableType(node.type)) throw new Error("Only Tasks and Subtasks can be scheduled.");
    await this.repository.update(node, {
      title: node.title,
      type: node.type,
      parentId: node.parentId,
      start: node.start ?? scheduled,
      scheduled,
      scheduledStartTime: node.scheduledStartTime,
      scheduledEndTime: node.scheduledEndTime,
      plannedMinutes: node.plannedMinutes,
      isMeeting: node.isMeeting,
      due: node.due,
      severity: node.severity,
      recurrence: node.recurrence,
      recurrenceInterval: node.recurrenceInterval,
      recurrenceWeekdays: node.recurrenceWeekdays,
      recurrenceTarget: node.recurrenceTarget,
      recurrenceStart: node.recurrenceStart,
      recurrenceEnd: node.recurrenceEnd,
      seriesId: node.seriesId
    });
    await this.refreshAll();
  }

  async setGoalStatus(node: GoalNode, status: ManualStatus): Promise<void> {
    const createNext = status === "completed" && node.metrics.status !== "completed" && node.recurrence !== "none";
    await this.repository.setStatus(node, status);
    if (createNext) {
      const next = await this.repository.createNextOccurrence(node, todayIso());
      if (next) new Notice("Completed and created the next recurring occurrence.");
    }
    for (const list of this.lists) {
      for (const item of list.items.filter((candidate) => candidate.linkedGoalId === node.stableId)) {
        item.status = status === "completed" ? "finished" : status === "in-progress" ? "in-progress" : "not-finished";
        item.completedAt = status === "completed" ? listIsoDateTime() : undefined;
      }
    }
    await this.persistData();
    await this.refreshAll();
  }

  async setGoalArchived(node: GoalNode, archived: boolean): Promise<void> {
    if (archived && node.metrics.status !== "completed") {
      new Notice("Only completed work can be archived.");
      return;
    }
    await this.repository.setArchived(node, archived);
    await this.refreshAll();
  }

  async stopGoalRecurrence(node: GoalNode): Promise<void> {
    const updated = await this.repository.stopRecurrence(node);
    await this.refreshAll();
    new Notice(`Stopped repeating “${node.title}” across ${updated} occurrence${updated === 1 ? "" : "s"}.`);
  }

  async createStarterTree(): Promise<void> {
    if (this.loadSnapshot().all.length > 0) {
      new Notice("The starter tree is only available when the Goal Tree folder has no goal items.");
      return;
    }
    try {
      await this.repository.createStarterTree(todayIso());
      await this.refreshAll();
      new Notice("Starter goal tree created.");
      await this.activateView();
    } catch (error) {
      new Notice(`Could not create the starter tree: ${errorMessage(error)}`);
    }
  }

  async organizeGoalFiles(): Promise<void> {
    const forest = this.loadSnapshot();
    if (forest.all.length === 0) {
      new Notice("There are no goal files to organize.");
      return;
    }
    try {
      const result = await this.repository.organizeIntoHierarchy(forest);
      await this.refreshAll();
      const skipped = result.skipped > 0 ? ` ${result.skipped} file(s) were skipped because a target already exists.` : "";
      new Notice(`Organized ${result.moved} goal file(s).${skipped}`);
    } catch (error) {
      new Notice(`Could not organize goal files: ${errorMessage(error)}`);
    }
  }

  async repairGoalHierarchy(): Promise<void> {
    const result = await this.repository.repairHierarchy(this.loadSnapshot());
    await this.refreshAll();
    const unresolved = result.unresolved > 0 ? ` ${result.unresolved} item(s) still need a valid parent.` : "";
    new Notice(`Repaired ${result.updated} item(s).${unresolved}`);
  }

  async openGoal(node: GoalNode): Promise<void> {
    const file = this.repository.fileForNode(node);
    if (!file) {
      new Notice("The goal note could not be found.");
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  private validateGoalFields(input: NewGoalInput | EditGoalInput, existing?: GoalNode): void {
    if (!input.title.trim()) throw new Error("Enter a title.");
    if (hasPlanningDates(input.type) && !input.start) {
      throw new Error(`Choose a start date for this ${input.type}.`);
    }
    if (input.scheduledStartTime || input.scheduledEndTime) {
      if (!isActionableType(input.type)) throw new Error("Specific times are available only for tasks and subtasks.");
      if (!input.scheduled && input.recurrence === "none") {
        throw new Error("Choose a planned day before adding a specific time.");
      }
      if (!input.scheduledStartTime || !input.scheduledEndTime) throw new Error("Enter both the start and end time.");
      if (input.scheduledStartTime >= input.scheduledEndTime) throw new Error("End time must be after start time.");
    }
    if (input.plannedMinutes !== undefined && input.plannedMinutes <= 0) {
      throw new Error("Planned duration must be greater than zero.");
    }
    if (input.start && input.due && input.start > input.due) throw new Error("Start date must be on or before the due date.");
    if (input.scheduled && input.start && input.scheduled < input.start) throw new Error("Planned day cannot be before the start date.");
    if (input.scheduled && input.due && input.scheduled > input.due) throw new Error("Planned day cannot be after the due date.");
    const repeatStart = input.recurrenceStart ?? input.start;
    if (input.recurrenceEnd && repeatStart && input.recurrenceEnd < repeatStart) {
      throw new Error("Repeat until must be on or after the start date.");
    }
    if (input.recurrence === "specific-weekdays" && (input.recurrenceWeekdays?.length ?? 0) === 0) {
      throw new Error("Select at least one weekday.");
    }
    if (input.recurrence === "weekly-target" && (!input.recurrenceTarget || input.recurrenceTarget < 1)) {
      throw new Error("Weekly target must be at least 1.");
    }
    if (input.type === "area") {
      if (input.parentId) throw new Error("Life areas must be root items.");
      return;
    }
    const parent = input.parentId ? this.loadSnapshot().all.find((node) => node.id === input.parentId) : undefined;
    if (!parent || !canParentType(parent.type, input.type)) {
      throw new Error(`The selected parent is not valid for a ${input.type}.`);
    }
    if (existing && (parent.stableId === existing.stableId || this.isDescendant(parent, existing))) {
      throw new Error("The selected parent would create a circular hierarchy.");
    }
  }

  private isDescendant(candidate: GoalNode, ancestor: GoalNode): boolean {
    let cursor: GoalNode | undefined = candidate;
    const byPath = new Map(this.loadSnapshot().all.map((node) => [node.id, node]));
    const visited = new Set<string>();
    while (cursor?.parentId && !visited.has(cursor.parentId)) {
      if (cursor.parentId === ancestor.id) return true;
      visited.add(cursor.parentId);
      cursor = byPath.get(cursor.parentId);
    }
    return false;
  }

  private async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as StoredData | null;
    const defaultSeverity = saved?.defaultSeverity
      ? normalizeSeverity(saved.defaultSeverity)
      : saved?.defaultWeight !== undefined
        ? severityFromLegacyWeight(saved.defaultWeight)
        : DEFAULT_SETTINGS.defaultSeverity;
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved ?? {}, { defaultSeverity });
    delete merged.defaultWeight;
    delete merged.defaultProgressMode;
    delete merged.pomodoroState;
    delete merged.workTimerState;
    delete merged.focusSessions;
    this.settings = merged;
    this.lists = normalizeLists(saved?.lists);
  }

  private listItem(listId: string, itemId: string): GoalListItem {
    const item = this.lists.find((list) => list.id === listId)?.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("List item not found.");
    return item;
  }

  private syncListLinks(forest: GoalForest): boolean {
    let changed = false;
    const byStableId = new Map(forest.all.map((node) => [node.stableId, node]));
    for (const list of this.lists) {
      for (const item of list.items) {
        if (!item.linkedGoalId) continue;
        const node = byStableId.get(item.linkedGoalId);
        if (!node) {
          delete item.linkedGoalId;
          changed = true;
          continue;
        }
        const nextStatus: ListItemStatus = node.metrics.status === "completed"
          ? "finished"
          : node.metrics.status === "in-progress"
            ? "in-progress"
            : "not-finished";
        if (item.status === nextStatus) continue;
        item.status = nextStatus;
        item.completedAt = nextStatus === "finished" ? node.completedAt ?? node.metrics.effectiveCompletedAt ?? listIsoDateTime() : undefined;
        changed = true;
      }
    }
    return changed;
  }

  private async activateView(tab?: GoalTreeTab): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GOAL_TREE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_GOAL_TREE, active: true });
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof GoalTreeView && tab) await leaf.view.setActiveTab(tab);
  }

  private queueRefresh(delay = 250): void {
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshAll();
    }, delay);
  }

  private async persistData(): Promise<void> {
    await this.saveData({
      ...this.settings,
      lists: this.lists
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isActionableType(type: GoalNode["type"]): boolean {
  return type === "task" || type === "subtask";
}

function hasPlanningDates(type: GoalNode["type"]): boolean {
  return type !== "area";
}
