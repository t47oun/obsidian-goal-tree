import {
  App,
  ButtonComponent,
  DropdownComponent,
  ItemView,
  Menu,
  Modal,
  Notice,
  Setting,
  setIcon,
  TextComponent,
  WorkspaceLeaf
} from "obsidian";
import {
  canParentType,
  CalculatedStatus,
  collectionProgress,
  GoalForest,
  GoalNode,
  GoalSeverity,
  GoalType,
  isActionableWorkItem,
  isLeaf,
  isWorkItem,
  KanbanScope,
  ManualStatus,
  RecurrenceRule,
  workHierarchyRoot
} from "./engine";
import { EditGoalInput, GoalTreeSettings, NewGoalInput } from "./repository";
import { GoalList, GoalListItem, ListItemStatus, sortedListItems } from "./lists";

export const VIEW_TYPE_GOAL_TREE = "goal-tree-view";
export type GoalTreeTab = "overview" | "today" | "tree" | "graph" | "calendar" | "kanban" | "lists" | "review";
type ReviewRange = "today" | "week" | "month" | "quarter" | "year" | "all" | "custom";
interface DateRange { start?: string; end?: string }

export interface GoalTreeHost {
  settings: GoalTreeSettings;
  saveSettings(): Promise<void>;
  loadSnapshot(): GoalForest;
  refreshAll(): Promise<void>;
  createGoal(input: NewGoalInput): Promise<void>;
  updateGoal(node: GoalNode, input: EditGoalInput): Promise<void>;
  updateGoalNotes(node: GoalNode, notes: string): Promise<void>;
  reorderGoal(node: GoalNode, target: GoalNode, placeAfter?: boolean): Promise<void>;
  duplicateGoal(node: GoalNode): Promise<void>;
  deleteGoal(node: GoalNode, deleteSeries?: boolean): Promise<void>;
  reparentGoal(node: GoalNode, parent: GoalNode): Promise<void>;
  scheduleGoal(node: GoalNode, scheduled: string): Promise<void>;
  createStarterTree(): Promise<void>;
  organizeGoalFiles(): Promise<void>;
  repairGoalHierarchy(): Promise<void>;
  openGoal(node: GoalNode): Promise<void>;
  setGoalStatus(node: GoalNode, status: ManualStatus): Promise<void>;
  setGoalArchived(node: GoalNode, archived: boolean): Promise<void>;
  stopGoalRecurrence(node: GoalNode): Promise<void>;
  getLists(): GoalList[];
  createList(title: string): Promise<void>;
  deleteList(listId: string): Promise<void>;
  reorderList(listId: string, targetListId: string, placeAfter?: boolean): Promise<void>;
  createListItem(listId: string, title: string, url?: string, notes?: string): Promise<void>;
  updateListItem(listId: string, itemId: string, title: string, url?: string, notes?: string): Promise<void>;
  setListItemStatus(listId: string, itemId: string, status: ListItemStatus): Promise<void>;
  reorderListItem(listId: string, itemId: string, targetItemId: string, placeAfter?: boolean): Promise<void>;
  deleteListItem(listId: string, itemId: string): Promise<void>;
  createGoalFromList(listId: string, itemId: string, input: NewGoalInput): Promise<void>;
  unlinkListItem(listId: string, itemId: string): Promise<void>;
}

export class GoalTreeView extends ItemView {
  navigation = false;
  private activeTab: GoalTreeTab = "overview";
  private selectedNodeId?: string;
  private collapsed = new Set<string>();
  private collapsedKanbanGroups = new Set<string>();
  private filter = "";
  private calendarMonth = startOfMonth(new Date());
  private calendarMode: "month" | "week" | "day" = window.matchMedia("(max-width: 600px)").matches ? "day" : "week";
  private calendarDate = new Date();
  private kanbanScope: KanbanScope = "weekly";
  private kanbanDate = new Date();
  private kanbanTypes = new Set<GoalType>();
  private reviewRange: ReviewRange = "month";
  private reviewMode: "attention" | "completed" = "attention";
  private reviewTypes = new Set<GoalType>(["goal", "project", "task", "subtask"]);
  private selectedListId?: string;
  private graphArea = "all";
  private graphStatus = "all";
  private graphDepth = 4;
  private customRangeStart = todayIso();
  private customRangeEnd = todayIso();
  private draggedTreeId?: string;
  private draggedKanbanId?: string;
  private draggedListItemId?: string;
  private draggedListId?: string;
  private renderSequence = 0;
  private graphCleanup?: () => void;

  constructor(leaf: WorkspaceLeaf, private readonly host: GoalTreeHost) {
    super(leaf);
    this.activeTab = host.settings.defaultView;
    this.kanbanScope = host.settings.kanbanDefaultScope;
    if (host.settings.kanbanShowProjects) this.kanbanTypes.add("project");
    if (host.settings.kanbanShowTasks) this.kanbanTypes.add("task");
    if (host.settings.kanbanShowSubtasks) this.kanbanTypes.add("subtask");
    if (this.kanbanTypes.size === 0) this.kanbanTypes.add("task");
  }

  getViewType(): string {
    return VIEW_TYPE_GOAL_TREE;
  }

  getDisplayText(): string {
    return "Goal Tree";
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    await this.render(this.host.loadSnapshot());
  }

  async onClose(): Promise<void> {
    this.graphCleanup?.();
    this.graphCleanup = undefined;
  }

  async setActiveTab(tab: GoalTreeTab): Promise<void> {
    this.activeTab = tab;
    await this.render(this.host.loadSnapshot());
  }

  async render(forest: GoalForest): Promise<void> {
    const sequence = ++this.renderSequence;
    const { contentEl } = this;
    this.graphCleanup?.();
    this.graphCleanup = undefined;
    contentEl.empty();
    contentEl.className = "view-content goal-tree-view";
    contentEl.addClass(`density-${this.host.settings.interfaceDensity}`);
    contentEl.addClass(`kanban-mobile-${this.host.settings.kanbanMobileMode}`);
    this.renderHeader(contentEl, forest);
    this.renderTabs(contentEl);
    this.renderDiagnostics(contentEl, forest);

    const workspace = contentEl.createDiv({ cls: `goal-tree-workspace${this.selectedNodeId ? " has-inspector" : ""}` });
    const panel = workspace.createDiv({ cls: `goal-tree-panel view-${this.activeTab}` });
    if (this.activeTab === "overview") this.renderOverview(panel, forest);
    else if (this.activeTab === "today") this.renderToday(panel, forest);
    else if (this.activeTab === "tree") this.renderTreeView(panel, forest);
    else if (this.activeTab === "graph") this.renderGraphView(panel, forest);
    else if (this.activeTab === "calendar") this.renderCalendarView(panel, forest);
    else if (this.activeTab === "kanban") this.renderKanbanView(panel, forest);
    else if (this.activeTab === "lists") this.renderListsView(panel, forest);
    else this.renderReviewView(panel, forest);
    const selected = forest.all.find((node) => node.stableId === this.selectedNodeId);
    if (selected) this.renderInspector(workspace, selected, forest);
    else this.selectedNodeId = undefined;
    if (sequence !== this.renderSequence) return;
  }

  private renderHeader(container: HTMLElement, forest: GoalForest): void {
    const header = container.createDiv({ cls: "goal-tree-header" });
    const titleGroup = header.createDiv({ cls: "goal-tree-title-group" });
    titleGroup.createEl("h2", { text: "Goal Tree" });
    titleGroup.createEl("p", { text: "Connect daily execution to meaningful life goals." });

    const actions = header.createDiv({ cls: "goal-tree-header-actions" });
    if (this.activeTab === "tree" || this.activeTab === "graph" || this.activeTab === "kanban" || this.activeTab === "review") {
      const search = new TextComponent(actions).setPlaceholder("Search items…").setValue(this.filter);
      search.inputEl.addClass("goal-tree-search");
      search.onChange((value) => {
        this.filter = value.trim().toLowerCase();
        void this.render(forest);
      });
    }

    new ButtonComponent(actions)
      .setButtonText("Add item")
      .setIcon("plus")
      .setCta()
      .onClick(() => this.openItemModal(forest));

    const more = actions.createEl("button", {
      cls: "goal-tree-header-more",
      attr: { type: "button", "aria-label": "Goal Tree actions" }
    });
    setIcon(more, "ellipsis-vertical");
    more.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("Repair properties and identities").setIcon("wrench").onClick(() => void this.host.repairGoalHierarchy())
      );
      menu.addItem((item) =>
        item.setTitle("Organize files into hierarchy").setIcon("folder-tree").onClick(() => void this.host.organizeGoalFiles())
      );
      if (forest.all.length === 0) {
        menu.addItem((item) =>
          item.setTitle("Create starter tree").setIcon("sparkles").onClick(() => void this.host.createStarterTree())
        );
      }
      menu.showAtMouseEvent(event);
    });
  }

  private renderTabs(container: HTMLElement): void {
    const tabs = container.createDiv({ cls: "goal-tree-tabs", attr: { role: "tablist" } });
    const definitions: Array<{ id: GoalTreeTab; label: string; icon: string }> = [
      { id: "overview", label: "Overview", icon: "layout-dashboard" },
      { id: "today", label: "Today", icon: "sun" },
      { id: "tree", label: "Tree", icon: "network" },
      { id: "graph", label: "Graph", icon: "share-2" },
      { id: "calendar", label: "Calendar", icon: "calendar-days" },
      { id: "kanban", label: "Kanban", icon: "columns-3" },
      { id: "lists", label: "Lists", icon: "list" },
      { id: "review", label: "Review", icon: "chart-no-axes-column-increasing" }
    ];
    for (const definition of definitions) {
      const button = tabs.createEl("button", {
        cls: `goal-tree-tab${this.activeTab === definition.id ? " is-active" : ""}`,
        attr: { type: "button", role: "tab", "aria-selected": String(this.activeTab === definition.id) }
      });
      const icon = button.createSpan();
      setIcon(icon, definition.icon);
      button.createSpan({ text: definition.label });
      button.addEventListener("click", () => void this.setActiveTab(definition.id));
    }
  }

  private renderDiagnostics(container: HTMLElement, forest: GoalForest): void {
    if (forest.diagnostics.length === 0) return;
    const warning = container.createDiv({ cls: "goal-tree-warning" });
    const icon = warning.createSpan({ cls: "goal-tree-warning-icon" });
    setIcon(icon, "triangle-alert");
    warning.createSpan({
      text: `${forest.diagnostics.length} hierarchy issue${forest.diagnostics.length === 1 ? "" : "s"}. Use Repair, then edit any unresolved item.`
    });
    const repair = warning.createEl("button", { text: "Repair", attr: { type: "button" } });
    repair.addEventListener("click", () => void this.host.repairGoalHierarchy());
    warning.setAttr("title", forest.diagnostics.join("\n"));
  }

  private selectNode(node: GoalNode): void {
    this.selectedNodeId = node.stableId;
    void this.render(this.host.loadSnapshot());
  }

  private renderInspector(container: HTMLElement, node: GoalNode, forest: GoalForest): void {
    const inspector = container.createEl("aside", {
      cls: "goal-tree-inspector",
      attr: { "aria-label": `${node.title} details` }
    });
    const handle = inspector.createDiv({ cls: "goal-tree-inspector-handle" });
    handle.setAttr("aria-hidden", "true");
    const header = inspector.createDiv({ cls: "goal-tree-inspector-header" });
    const heading = header.createDiv();
    heading.createSpan({ text: label(node.type), cls: `goal-tree-inspector-type type-${node.type}` });
    heading.createEl("h3", { text: node.title });
    const close = this.iconButton(header, "x", "Close details", () => {
      this.selectedNodeId = undefined;
      void this.render(this.host.loadSnapshot());
    });
    close.addClass("goal-tree-inspector-close");

    const path = ancestorTitles(node, forest);
    if (path) inspector.createDiv({ cls: "goal-tree-inspector-path", text: path });

    if (node.type === "area") {
      const permanent = inspector.createDiv({ cls: "goal-tree-inspector-permanent" });
      const icon = permanent.createSpan();
      setIcon(icon, "infinity");
      permanent.createSpan({ text: "Permanent life area · no dates, status, severity, or completion" });
    } else {
      const status = inspector.createDiv({ cls: "goal-tree-inspector-status" });
      status.createSpan({ cls: `goal-tree-chip status-${node.metrics.status}`, text: label(node.metrics.status) });
      status.createSpan({ cls: `goal-tree-chip health-${node.metrics.health}`, text: label(node.metrics.health) });
      status.createSpan({ cls: `goal-tree-severity severity-${node.severity}`, text: `${label(node.severity)} severity` });
      this.renderProgress(inspector, node.metrics.progress);
      inspector.createDiv({ cls: "goal-tree-inspector-health-reason", text: healthReason(node) });

      const facts = inspector.createDiv({ cls: "goal-tree-inspector-facts" });
      this.renderInspectorFact(facts, "calendar-range", "Start", node.start ? formatDateLabel(node.start) : "Not set");
      this.renderInspectorFact(facts, "calendar-clock", "Scheduled", inspectorScheduleText(node, this.host.settings.timeFormat));
      this.renderInspectorFact(facts, "flag", "Due", node.due ? formatDateLabel(node.due) : "Unknown");
      if (node.recurrence !== "none") {
        this.renderInspectorFact(facts, "repeat-2", "Repeats", recurrenceDescription(node));
      }

      if (isActionableWorkItem(node)) {
        const statusActions = inspector.createDiv({ cls: "goal-tree-inspector-status-actions" });
        for (const definition of [
          { status: "not-started" as ManualStatus, label: "Not started" },
          { status: "in-progress" as ManualStatus, label: "In progress" },
          { status: "completed" as ManualStatus, label: "Completed" }
        ]) {
          const button = statusActions.createEl("button", {
            text: definition.label,
            cls: node.metrics.status === definition.status ? "is-active" : "",
            attr: { type: "button" }
          });
          button.addEventListener("click", () => void this.host.setGoalStatus(node, definition.status));
        }
      }
    }

    const notesSection = inspector.createDiv({ cls: "goal-tree-inspector-notes" });
    notesSection.createEl("label", { text: "Notes" });
    const notes = notesSection.createEl("textarea", {
      attr: { placeholder: "Add a short note…", "aria-label": `Notes for ${node.title}` }
    });
    notes.value = node.notes ?? "";
    const notesActions = notesSection.createDiv({ cls: "goal-tree-inspector-notes-actions" });
    const noteState = notesActions.createSpan({ text: "", cls: "goal-tree-inspector-save-state" });
    const saveNote = notesActions.createEl("button", { text: "Save note", attr: { type: "button" } });
    saveNote.addEventListener("click", async () => {
      saveNote.disabled = true;
      noteState.setText("Saving…");
      try {
        await this.host.updateGoalNotes(node, notes.value);
        noteState.setText("Saved");
      } catch (error) {
        noteState.setText(error instanceof Error ? error.message : "Could not save");
      } finally {
        saveNote.disabled = false;
      }
    });

    const actions = inspector.createDiv({ cls: "goal-tree-inspector-actions" });
    new ButtonComponent(actions).setButtonText("Edit").setIcon("pencil").onClick(() =>
      this.openItemModal(forest, undefined, undefined, undefined, node));
    new ButtonComponent(actions).setButtonText("Open note").setIcon("file-text").onClick(() => void this.host.openGoal(node));
    new ButtonComponent(actions).setButtonText("Delete").setIcon("trash-2").setWarning().onClick(() =>
      this.requestDelete(node, forest));
  }

  private renderInspectorFact(container: HTMLElement, iconName: string, name: string, value: string): void {
    const fact = container.createDiv({ cls: "goal-tree-inspector-fact" });
    const icon = fact.createSpan();
    setIcon(icon, iconName);
    const text = fact.createDiv();
    text.createSpan({ text: name });
    text.createEl("strong", { text: value });
  }

  private requestDelete(node: GoalNode, forest: GoalForest): void {
    if (this.host.settings.confirmBeforeDelete) {
      new DeleteGoalModal(this.app, node, forest, this.host).open();
      return;
    }
    void this.host.deleteGoal(node, false);
  }

  private renderViewHeading(
    container: HTMLElement,
    iconName: string,
    title: string,
    description: string
  ): HTMLDivElement {
    const heading = container.createDiv({ cls: "goal-tree-view-heading" });
    const identity = heading.createDiv({ cls: "goal-tree-view-identity" });
    const icon = identity.createDiv({ cls: "goal-tree-view-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, iconName);
    const copy = identity.createDiv({ cls: "goal-tree-view-copy" });
    copy.createEl("h3", { text: title });
    copy.createEl("p", { text: description });
    return heading.createDiv({ cls: "goal-tree-view-actions" });
  }

  private renderOverview(container: HTMLElement, forest: GoalForest): void {
    const actions = this.renderViewHeading(
      container,
      "layout-dashboard",
      "Overview",
      "See current progress, balance across life areas, and the work that needs attention."
    );
    const activeGoals = forest.all.filter((node) => node.type === "goal" && !node.archived && node.metrics.status !== "cancelled");
    actions.createSpan({
      cls: "goal-tree-context-pill",
      text: `${activeGoals.length} active goal${activeGoals.length === 1 ? "" : "s"}`
    });
    this.renderSummary(container, forest);
    if (forest.all.length === 0) {
      this.renderEmptyState(container);
      return;
    }
    this.renderOverviewAreas(container, forest);
    this.renderFocusLists(container, forest);
  }

  private renderSummary(container: HTMLElement, forest: GoalForest): void {
    const active = forest.all.filter((node) => node.metrics.status !== "cancelled" && !node.archived);
    const work = active.filter(isActionableWorkItem);
    const byId = new Map(forest.all.map((node) => [node.id, node]));
    const currentGoals = active.filter(
      (node) => node.type === "goal" && node.parentId && byId.get(node.parentId)?.type === "area"
    );
    const currentGoalsProgress = collectionProgress(currentGoals);
    const today = todayIso();
    const completedToday = work.filter((node) => completionDateTime(node).slice(0, 10) === today).length;
    const plannedToday = work.filter((node) => isExplicitlyPlannedOn(node, today) && node.metrics.status !== "completed").length;
    const overdue = work.filter((node) => node.metrics.health === "overdue").length;
    const summary = container.createDiv({ cls: "goal-tree-overview-highlights" });
    const progressCard = summary.createDiv({ cls: "goal-tree-overview-highlight goal-tree-overview-progress" });
    const progressHeading = progressCard.createDiv({ cls: "goal-tree-overview-highlight-heading" });
    const progressIcon = progressHeading.createSpan();
    setIcon(progressIcon, "target");
    const progressCopy = progressHeading.createDiv();
    progressCopy.createEl("h4", { text: "Goals progress" });
    progressCopy.createSpan({ text: "Progress across all current goals." });
    const progressBody = progressCard.createDiv({ cls: "goal-tree-overview-progress-body" });
    const ring = progressBody.createDiv({ cls: "goal-tree-progress-ring" });
    ring.style.setProperty("--goal-tree-progress", `${currentGoalsProgress}%`);
    ring.createEl("strong", { text: `${currentGoalsProgress}%` });
    const progressDetails = progressBody.createDiv();
    progressDetails.createEl("strong", { text: `${currentGoals.filter((goal) => goal.metrics.status === "completed").length} of ${currentGoals.length} goals completed` });
    progressDetails.createSpan({ text: currentGoals.length > 0 ? "Keep the next actionable step visible." : "Create a current goal inside a life area." });

    const todayCard = summary.createDiv({ cls: "goal-tree-overview-highlight goal-tree-overview-today" });
    const todayHeading = todayCard.createDiv({ cls: "goal-tree-overview-highlight-heading" });
    const todayIcon = todayHeading.createSpan();
    setIcon(todayIcon, "calendar-days");
    const todayCopy = todayHeading.createDiv();
    todayCopy.createEl("h4", { text: "Today" });
    todayCopy.createSpan({ text: "Tasks and goals scheduled for today." });
    const todayMetrics = todayCard.createDiv({ cls: "goal-tree-overview-today-metrics" });
    for (const metric of [
      { label: "Planned", value: plannedToday, icon: "calendar-check" },
      { label: "Completed", value: completedToday, icon: "circle-check-big" },
      { label: "Overdue", value: overdue, icon: "triangle-alert", alert: overdue > 0 }
    ]) {
      const item = todayMetrics.createDiv({ cls: `goal-tree-overview-today-metric${metric.alert ? " is-alert" : ""}` });
      const icon = item.createSpan();
      setIcon(icon, metric.icon);
      const copy = item.createDiv();
      copy.createEl("strong", { text: String(metric.value) });
      copy.createSpan({ text: metric.label });
    }
  }

  private renderSummaryCard(
    container: HTMLElement,
    labelText: string,
    value: string,
    iconName: string,
    progress?: number,
    alert = false
  ): void {
    const card = container.createDiv({ cls: `goal-tree-summary-card${alert ? " is-alert" : ""}` });
    const icon = card.createSpan({ cls: "goal-tree-summary-icon" });
    setIcon(icon, iconName);
    const text = card.createDiv({ cls: "goal-tree-summary-text" });
    text.createSpan({ cls: "goal-tree-summary-value", text: value });
    text.createSpan({ cls: "goal-tree-summary-label", text: labelText });
    if (progress !== undefined) this.renderProgress(card, progress, true);
  }

  private renderOverviewAreas(container: HTMLElement, forest: GoalForest): void {
    const section = container.createDiv({ cls: "goal-tree-overview-section" });
    const heading = section.createDiv({ cls: "goal-tree-section-heading" });
    const headingIdentity = heading.createDiv({ cls: "goal-tree-section-identity" });
    const headingIcon = headingIdentity.createSpan();
    setIcon(headingIcon, "layers-3");
    const headingCopy = headingIdentity.createDiv();
    headingCopy.createEl("h3", { text: "Life areas" });
    headingCopy.createSpan({ text: "Permanent contexts for goals and projects" });
    const grid = section.createDiv({ cls: "goal-tree-area-grid" });
    for (const area of forest.roots.filter((node) => node.type === "area")) {
      const currentGoals = area.children.filter(
        (child) => child.type === "goal" && child.metrics.status !== "cancelled" && !child.archived
      );
      const card = grid.createDiv({ cls: `goal-tree-area-card health-${area.metrics.health}` });
      const top = card.createDiv({ cls: "goal-tree-area-card-top" });
      const identity = top.createDiv({ cls: "goal-tree-area-card-identity" });
      const areaIcon = identity.createSpan({ cls: "goal-tree-area-card-icon", attr: { "aria-hidden": "true" } });
      setIcon(areaIcon, "infinity");
      const title = identity.createEl("button", { text: area.title, attr: { type: "button" } });
      title.addEventListener("click", () => this.selectNode(area));
      const arrow = top.createEl("button", { cls: "goal-tree-area-card-open", attr: { type: "button", "aria-label": `Open ${area.title}` } });
      setIcon(arrow, "chevron-right");
      arrow.addEventListener("click", () => this.selectNode(area));
      if (currentGoals.length > 0) this.renderProgress(card, area.metrics.progress, true);
      const atRisk = currentGoals.filter((goal) => goal.metrics.health === "at-risk" || goal.metrics.health === "overdue").length;
      card.createDiv({ cls: "goal-tree-area-time", text: currentGoals.length === 0
        ? "No active goals"
        : atRisk > 0
          ? `${area.metrics.progress}% progress · ${atRisk} need attention`
          : `${area.metrics.progress}% progress · On track` });
    }
  }

  private renderFocusLists(container: HTMLElement, forest: GoalForest): void {
    const today = todayIso();
    const work = forest.all.filter((node) => isActionableWorkItem(node) && !node.archived && node.metrics.status !== "completed" && node.metrics.status !== "cancelled");
    const todayWork = work.filter((node) => isExplicitlyPlannedOn(node, today));
    const overdue = work.filter((node) => node.metrics.health === "overdue");
    if (todayWork.length === 0 && overdue.length === 0) return;
    const focus = container.createDiv({ cls: "goal-tree-overview-work" });
    if (overdue.length > 0) this.renderOverviewWorkTable(focus, "Needs attention", "triangle-alert", overdue, forest, true);
    if (todayWork.length > 0) this.renderOverviewWorkTable(focus, "Planned today", "calendar-check", todayWork, forest);
  }

  private renderOverviewWorkTable(
    container: HTMLElement,
    titleText: string,
    iconName: string,
    nodes: GoalNode[],
    forest: GoalForest,
    alert = false
  ): void {
    const section = container.createDiv({ cls: `goal-tree-overview-table${alert ? " is-alert" : ""}` });
    const heading = section.createDiv({ cls: "goal-tree-overview-table-heading" });
    const identity = heading.createDiv();
    const icon = identity.createSpan();
    setIcon(icon, iconName);
    identity.createEl("h3", { text: titleText });
    identity.createSpan({ text: alert ? "Goals and tasks that require attention." : "Work explicitly planned for today." });
    heading.createSpan({ text: String(nodes.length), cls: "goal-tree-count" });
    const columnHeader = section.createDiv({ cls: "goal-tree-overview-table-columns" });
    columnHeader.createSpan({ text: "Item" });
    columnHeader.createSpan({ text: "Due date" });
    columnHeader.createSpan({ text: "Status" });
    for (const node of nodes.slice(0, 8)) {
      const row = section.createDiv({ cls: `goal-tree-overview-table-row health-${node.metrics.health}` });
      const check = row.createEl("button", { cls: "goal-tree-mini-check", attr: { type: "button", "aria-label": `Complete ${node.title}` } });
      setIcon(check, node.metrics.status === "completed" ? "check" : "circle");
      if (isLeaf(node)) check.addEventListener("click", () => void this.toggleCompleted(node));
      else check.disabled = true;
      const details = row.createDiv({ cls: "goal-tree-overview-table-details" });
      const title = details.createEl("button", { text: itemDisplayTitle(node), attr: { type: "button" } });
      title.addEventListener("click", () => this.selectNode(node));
      details.createSpan({ text: ancestorTitles(node, forest) || label(node.type) });
      row.createSpan({ cls: "goal-tree-overview-table-date", text: node.due ? formatDateLabel(node.due) : node.scheduled ? formatDateLabel(node.scheduled) : "No date" });
      row.createSpan({ cls: `goal-tree-chip health-${node.metrics.health}`, text: label(node.metrics.health) });
    }
  }

  private renderToday(container: HTMLElement, forest: GoalForest): void {
    const today = todayIso();
    const actions = this.renderViewHeading(
      container,
      "sun",
      "Today",
      "Execute today's plan without losing sight of the project and goal behind it."
    );
    actions.createSpan({ cls: "goal-tree-context-pill", text: formatDateLabel(today) });
    new ButtonComponent(actions).setButtonText("Add today task").setIcon("plus").setCta().onClick(() =>
      this.openItemModal(forest, undefined, "task", today)
    );

    const work = forest.all.filter(
      (node) => isActionableWorkItem(node) && !node.archived && node.metrics.status !== "completed" && node.metrics.status !== "cancelled"
    );
    const used = new Set<string>();
    const take = (predicate: (node: GoalNode) => boolean): GoalNode[] => work.filter((node) => {
      if (used.has(node.stableId) || !predicate(node)) return false;
      used.add(node.stableId);
      return true;
    });
    const scheduled = take((node) => isExplicitlyPlannedOn(node, today));
    const overdue = take((node) => node.metrics.health === "overdue");
    const inProgress = take((node) => node.metrics.status === "in-progress");
    const available = this.host.settings.todayIncludeAvailable
      ? take((node) => !node.scheduled && Boolean(node.start && node.start <= today && (!node.due || node.due >= today)))
      : [];
    const inbox = take((node) => !node.start && !node.scheduled && !node.due);
    const completed = forest.all.filter(
      (node) => isActionableWorkItem(node) && completionDateTime(node).slice(0, 10) === today
    );

    const strip = container.createDiv({ cls: "goal-tree-today-strip" });
    this.renderSummaryCard(strip, "Open today", String(scheduled.length + overdue.length + inProgress.length + available.length), "list-checks");
    this.renderSummaryCard(strip, "Completed", String(completed.length), "circle-check-big");
    this.renderSummaryCard(strip, "Habits due", String(scheduled.filter((node) => node.recurrence !== "none").length), "repeat-2");
    this.renderSummaryCard(strip, "Meetings", String(scheduled.filter((node) => node.isMeeting).length), "calendar-clock");

    const sections = container.createDiv({ cls: "goal-tree-today-sections" });
    this.renderWorkSection(sections, "Planned today", "calendar-check", scheduled, forest);
    this.renderWorkSection(sections, "Overdue", "triangle-alert", overdue, forest, true);
    this.renderWorkSection(sections, "In progress", "play", inProgress, forest);
    if (this.host.settings.todayIncludeAvailable) this.renderWorkSection(sections, "Available today", "calendar-range", available, forest);
    this.renderWorkSection(sections, "Unscheduled inbox", "inbox", inbox, forest);
    this.renderWorkSection(sections, "Completed today", "circle-check-big", completed, forest);
  }

  private renderWorkSection(
    container: HTMLElement,
    titleText: string,
    iconName: string,
    nodes: GoalNode[],
    forest: GoalForest,
    alert = false
  ): void {
    const section = container.createDiv({ cls: `goal-tree-work-section${alert ? " is-alert" : ""}` });
    const heading = section.createDiv({ cls: "goal-tree-work-section-heading" });
    const icon = heading.createSpan();
    setIcon(icon, iconName);
    heading.createEl("h4", { text: titleText });
    heading.createSpan({ text: String(nodes.length), cls: "goal-tree-count" });
    if (nodes.length === 0) {
      section.createDiv({ cls: "goal-tree-section-empty", text: "Nothing here." });
      return;
    }
    for (const node of nodes) this.renderCompactWorkRow(section, node, forest);
  }

  private renderCompactWorkRow(container: HTMLElement, node: GoalNode, forest: GoalForest): void {
    const row = container.createDiv({ cls: `goal-tree-focus-row health-${node.metrics.health}` });
    const manual = isLeaf(node);
    const check = row.createEl("button", {
      cls: `goal-tree-mini-check${manual ? "" : " is-automatic"}`,
      attr: { "aria-label": manual ? `Complete ${node.title}` : "Status is calculated from subtasks", type: "button" }
    });
    setIcon(check, manual ? (node.metrics.status === "completed" ? "check" : "circle") : "git-branch");
    check.disabled = !manual;
    if (manual) check.addEventListener("click", () => void this.toggleCompleted(node));
    const details = row.createDiv({ cls: "goal-tree-compact-details" });
    const title = details.createEl("button", { cls: "goal-tree-focus-title", text: itemDisplayTitle(node), attr: { type: "button" } });
    title.addEventListener("click", () => this.selectNode(node));
    const path = ancestorTitles(node, forest);
    if (path) details.createSpan({ cls: "goal-tree-focus-task-path", text: path });
    const meta = row.createDiv({ cls: "goal-tree-compact-actions" });
    if (node.isMeeting) {
      const meeting = meta.createSpan({ cls: "goal-tree-inline-kind", attr: { title: "Meeting" } });
      setIcon(meeting, "calendar-clock");
    }
    if (node.recurrence !== "none") {
      const habit = meta.createSpan({ cls: "goal-tree-inline-kind", attr: { title: recurrenceDescription(node) } });
      setIcon(habit, "repeat-2");
    }
    if (node.scheduled) {
      meta.createSpan({
        text: `${formatDateLabel(node.scheduled)}${node.scheduledStartTime ? ` · ${formatClockTime(node.scheduledStartTime, this.host.settings.timeFormat)}` : ""}`
      });
    } else if (node.due) {
      meta.createSpan({ text: `Due ${formatDateLabel(node.due)}` });
    }
  }

  private renderTreeView(container: HTMLElement, forest: GoalForest): void {
    if (forest.all.length === 0) {
      this.renderEmptyState(container);
      return;
    }
    const actions = this.renderViewHeading(
      container,
      "network",
      "Goal hierarchy",
      "Drag an item onto a compatible parent to reparent it. Select any row to open its details."
    );
    actions.createSpan({ text: `${forest.all.length} items`, cls: "goal-tree-context-pill" });
    this.iconButton(actions, "unfold-vertical", "Expand all", () => {
      this.collapsed.clear();
      void this.render(this.host.loadSnapshot());
    });
    this.iconButton(actions, "fold-vertical", "Collapse all", () => {
      for (const node of forest.all) if (node.children.length > 0) this.collapsed.add(node.stableId);
      void this.render(this.host.loadSnapshot());
    });
    const visibleRoots = forest.roots.filter((root) => this.matchesTree(root));
    if (visibleRoots.length === 0) {
      container.createDiv({ cls: "goal-tree-no-results", text: `No items match “${this.filter}”.` });
      return;
    }
    const roots = container.createDiv({ cls: "goal-tree-roots" });
    for (const root of visibleRoots) {
      const card = roots.createDiv({ cls: `goal-tree-root-card health-${root.metrics.health}` });
      this.renderNode(card, root, forest, 0, true);
    }
  }

  private renderNode(
    container: HTMLElement,
    node: GoalNode,
    forest: GoalForest,
    depth: number,
    isRoot = false
  ): void {
    if (!this.matchesTree(node) || node.archived) return;
    const children = node.children.filter((child) => !child.archived && this.matchesTree(child));
    const forcedOpen = Boolean(this.filter);
    const isCollapsed = !forcedOpen && this.collapsed.has(node.stableId);
    const wrapper = container.createDiv({ cls: `goal-tree-node depth-${Math.min(depth, 6)}` });
    const row = wrapper.createDiv({ cls: `goal-tree-row${isRoot ? " is-root" : ""}` });
    row.setAttr("draggable", "true");
    row.addEventListener("dragstart", () => {
      this.draggedTreeId = node.stableId;
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => {
      this.draggedTreeId = undefined;
      row.removeClass("is-dragging");
    });
    row.addEventListener("dragover", (event) => {
      const dragged = forest.all.find((item) => item.stableId === this.draggedTreeId);
      if (dragged && canParentType(node.type, dragged.type)) {
        event.preventDefault();
        row.addClass("is-drop-target");
      }
    });
    row.addEventListener("dragleave", () => row.removeClass("is-drop-target"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.removeClass("is-drop-target");
      const dragged = forest.all.find((item) => item.stableId === this.draggedTreeId);
      this.draggedTreeId = undefined;
      if (dragged) void this.host.reparentGoal(dragged, node);
    });

    const leading = row.createDiv({ cls: "goal-tree-leading" });
    if (children.length > 0) {
      const collapse = leading.createEl("button", {
        cls: "goal-tree-collapse",
        attr: { type: "button", "aria-label": isCollapsed ? `Expand ${node.title}` : `Collapse ${node.title}` }
      });
      setIcon(collapse, isCollapsed ? "chevron-right" : "chevron-down");
      collapse.addEventListener("click", () => {
        if (this.collapsed.has(node.stableId)) this.collapsed.delete(node.stableId);
        else this.collapsed.add(node.stableId);
        void this.render(this.host.loadSnapshot());
      });
    } else {
      leading.createSpan({ cls: "goal-tree-collapse-spacer" });
    }
    const automatic = !isWorkItem(node) || !isLeaf(node);
    if (node.type === "area") {
      const permanent = leading.createSpan({ cls: "goal-tree-area-symbol", attr: { title: "Permanent life area" } });
      setIcon(permanent, "infinity");
    } else {
      const check = leading.createEl("button", {
        cls: `goal-tree-check status-${node.metrics.status}${automatic ? " is-automatic" : ""}`,
        attr: {
          type: "button",
          "aria-label": automatic
            ? "Status is calculated automatically"
            : `${node.metrics.status === "completed" ? "Reopen" : "Complete"} ${node.title}`
        }
      });
      setIcon(check, automatic ? "git-branch" : statusIcon(node.metrics.status));
      check.disabled = automatic;
      if (!automatic) check.addEventListener("click", () => void this.toggleCompleted(node));
    }
    const typeIcon = leading.createSpan({ cls: `goal-tree-type-icon type-${node.type}` });
    setIcon(typeIcon, iconForType(node.type));

    const main = row.createDiv({ cls: "goal-tree-row-main" });
    const titleLine = main.createDiv({ cls: "goal-tree-title-line" });
    const title = titleLine.createEl("button", { cls: "goal-tree-title", text: itemDisplayTitle(node), attr: { type: "button" } });
    title.addEventListener("click", () => this.selectNode(node));
    if (node.type !== "area") {
      titleLine.createSpan({ cls: `goal-tree-chip status-${node.metrics.status}`, text: label(node.metrics.status) });
      titleLine.createSpan({ cls: `goal-tree-chip health-${node.metrics.health}`, text: label(node.metrics.health) });
    }
    const meta = main.createDiv({ cls: "goal-tree-meta" });
    meta.createSpan({ text: label(node.type) });
    if (node.type === "area") {
      meta.createSpan({ text: "Permanent life area" });
    } else {
      meta.createSpan({ cls: `goal-tree-severity severity-${node.severity}`, text: `${label(node.severity)} severity` });
    }
    if (node.scheduled) meta.createSpan({ text: `Planned ${node.scheduled}${scheduledTimeText(node, this.host.settings.timeFormat) ? ` · ${scheduledTimeText(node, this.host.settings.timeFormat)}` : ""}` });
    if (node.start) meta.createSpan({ text: `Start ${node.start}` });
    if (node.due) meta.createSpan({ text: `Due ${node.due}` });
    if (node.isMeeting) meta.createSpan({ text: "Meeting" });
    if (node.recurrence !== "none") meta.createSpan({ text: `Repeats ${recurrenceLabel(node.recurrence)}` });
    if (children.length > 0) meta.createSpan({ text: `${children.length} direct children` });
    const hasCurrentGoals = node.type !== "area" || node.children.some(
      (child) => child.type === "goal" && child.metrics.status !== "cancelled" && !child.archived
    );
    if (hasCurrentGoals) this.renderProgress(main, node.metrics.progress);
    else main.createDiv({ cls: "goal-tree-area-no-goals", text: "No active goals" });

    const actions = row.createDiv({ cls: "goal-tree-row-actions" });
    this.iconButton(actions, "plus", `Add child under ${node.title}`, () =>
      this.openItemModal(forest, node.id, childTypeFor(node.type))
    );
    this.iconButton(actions, "pencil", `Edit ${node.title}`, () => this.openItemModal(forest, undefined, undefined, undefined, node));
    const more = this.iconButton(actions, "ellipsis", `More actions for ${node.title}`, () => undefined);
    more.addEventListener("click", (event) => this.openNodeMenu(event, node, forest));

    if (!isCollapsed && children.length > 0) {
      const childContainer = wrapper.createDiv({ cls: "goal-tree-children" });
      for (const child of children) this.renderNode(childContainer, child, forest, depth + 1);
    }
  }

  private renderGraphView(container: HTMLElement, forest: GoalForest): void {
    const actions = this.renderViewHeading(
      container,
      "share-2",
      "Goal Graph",
      "Explore every Area, Goal, Project, Task, and Subtask in one responsive connected view."
    );
    actions.createSpan({ text: `${forest.all.filter((node) => !node.archived).length} nodes`, cls: "goal-tree-context-pill" });

    const controls = container.createDiv({ cls: "goal-tree-graph-controls" });
    const areaSelect = controls.createEl("select", { attr: { "aria-label": "Filter graph by Area" } });
    areaSelect.createEl("option", { value: "all", text: "All areas" });
    for (const area of forest.roots.filter((node) => node.type === "area")) {
      areaSelect.createEl("option", { value: area.stableId, text: area.title });
    }
    areaSelect.value = this.graphArea;
    areaSelect.addEventListener("change", () => {
      this.graphArea = areaSelect.value;
      void this.render(forest);
    });
    const statusSelect = controls.createEl("select", { attr: { "aria-label": "Filter graph by status" } });
    for (const [value, text] of [["all", "All statuses"], ["not-started", "Not started"], ["in-progress", "In progress"], ["completed", "Completed"], ["at-risk", "At risk"], ["overdue", "Overdue"]]) {
      statusSelect.createEl("option", { value, text });
    }
    statusSelect.value = this.graphStatus;
    statusSelect.addEventListener("change", () => {
      this.graphStatus = statusSelect.value;
      void this.render(forest);
    });
    const depthSelect = controls.createEl("select", { attr: { "aria-label": "Graph depth" } });
    for (const [value, text] of [["1", "Through goals"], ["2", "Through projects"], ["3", "Through tasks"], ["4", "All levels"]]) {
      depthSelect.createEl("option", { value, text });
    }
    depthSelect.value = String(this.graphDepth);
    depthSelect.addEventListener("change", () => {
      this.graphDepth = Number(depthSelect.value);
      void this.render(forest);
    });
    const labelsSelect = controls.createEl("select", { attr: { "aria-label": "Graph labels" } });
    for (const [value, text] of [["all", "All labels"], ["selected", "Selected labels"], ["hover", "Labels on hover"]]) {
      labelsSelect.createEl("option", { value, text });
    }
    labelsSelect.value = this.host.settings.graphLabels;
    labelsSelect.addEventListener("change", async () => {
      this.host.settings.graphLabels = labelsSelect.value as GoalTreeSettings["graphLabels"];
      await this.host.saveSettings();
      await this.render(forest);
    });

    const shell = container.createDiv({ cls: "goal-tree-graph-shell" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Interactive hierarchical graph of the Goal Tree");
    shell.appendChild(svg);

    const areas = forest.roots.filter((node) => node.type === "area" && (this.graphArea === "all" || node.stableId === this.graphArea));
    const typeDepth: Record<GoalType, number> = { area: 0, goal: 1, project: 2, task: 3, subtask: 4 };
    const graphEntries: ForceGraphEntry[] = [];
    const matchesBranch = (node: GoalNode): boolean => {
      if (this.graphStatus === "all") return true;
      if (node.metrics.status === this.graphStatus || node.metrics.health === this.graphStatus) return true;
      return node.children.some((child) => typeDepth[child.type] <= this.graphDepth && matchesBranch(child));
    };
    const visit = (node: GoalNode, parentId: string): void => {
      const depth = typeDepth[node.type];
      if (depth > this.graphDepth || !matchesBranch(node)) return;
      graphEntries.push({ id: node.stableId, parentId, node });
      const children = node.children.filter((child) => typeDepth[child.type] <= this.graphDepth && !child.archived && child.metrics.status !== "cancelled");
      children.forEach((child) => visit(child, node.stableId));
    };
    areas.forEach((area) => visit(area, "root"));

    if (graphEntries.length === 0) shell.createDiv({ cls: "goal-tree-graph-empty", text: "No items match the selected filters." });
    const graphNavigation = mountForceGraph(svg, graphEntries, (node) => this.selectNode(node), {
      motion: this.host.settings.graphMotion,
      labels: this.host.settings.graphLabels,
      spacing: this.host.settings.graphSpacing,
      selectedId: this.selectedNodeId
    });
    this.graphCleanup = graphNavigation.destroy;
    const zoomControls = controls.createDiv({ cls: "goal-tree-graph-zoom" });
    new ButtonComponent(zoomControls).setIcon("minus").setTooltip("Zoom out").onClick(graphNavigation.zoomOut);
    new ButtonComponent(zoomControls).setIcon("scan").setTooltip("Reset graph").onClick(graphNavigation.reset);
    new ButtonComponent(zoomControls).setIcon("plus").setTooltip("Zoom in").onClick(graphNavigation.zoomIn);
    const legend = shell.createDiv({ cls: "goal-tree-graph-legend" });
    for (const [className, text] of [["area", "Area"], ["not-started", "Not started"], ["in-progress", "In progress"], ["completed-on-time", "Completed"], ["at-risk", "At risk"], ["overdue", "Overdue"]]) {
      const item = legend.createSpan();
      item.createSpan({ cls: `goal-tree-graph-legend-dot ${className}` });
      item.createSpan({ text });
    }
  }

  private renderListsView(container: HTMLElement, forest: GoalForest): void {
    const lists = this.host.getLists();
    if (!this.selectedListId || !lists.some((list) => list.id === this.selectedListId)) this.selectedListId = lists[0]?.id;
    const actions = this.renderViewHeading(
      container,
      "list",
      "Lists",
      "Keep personal lists and promote any item into Goal Tree when it becomes actionable."
    );
    actions.createSpan({ text: `${lists.length} list${lists.length === 1 ? "" : "s"}`, cls: "goal-tree-context-pill" });
    new ButtonComponent(actions).setButtonText("New list").setIcon("plus").onClick(() =>
      new ListNameModal(this.app, (title) => this.host.createList(title)).open()
    );
    const storage = container.createDiv({ cls: "goal-tree-list-storage" });
    const storageIcon = storage.createSpan();
    setIcon(storageIcon, "file-text");
    storage.createSpan({ text: `Saved as Markdown in ${this.host.settings.goalsFolder}/Lists` });
    const layout = container.createDiv({ cls: "goal-tree-lists-layout" });
    const sidebar = layout.createDiv({ cls: "goal-tree-lists-sidebar" });
    for (const [listIndex, list] of lists.entries()) {
      const selector = sidebar.createDiv({
        cls: `goal-tree-list-selector${list.id === this.selectedListId ? " is-active" : ""}`,
        attr: { "data-list-id": list.id }
      });
      const handle = selector.createEl("button", {
        cls: "goal-tree-list-selector-handle",
        attr: { type: "button", draggable: "true", "aria-label": `Reorder ${list.title}`, title: "Drag to reorder list" }
      });
      setIcon(handle, "grip-vertical");
      handle.addEventListener("dragstart", (event) => {
        this.draggedListId = list.id;
        event.dataTransfer?.setData("text/goal-tree-list", list.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        selector.addClass("is-dragging");
      });
      handle.addEventListener("dragend", () => {
        this.draggedListId = undefined;
        selector.removeClass("is-dragging");
        sidebar.querySelectorAll(".is-drop-before, .is-drop-after").forEach((element) =>
          element.removeClasses(["is-drop-before", "is-drop-after"]));
      });
      let placeAfter = false;
      selector.addEventListener("dragover", (event) => {
        if (!this.draggedListId || this.draggedListId === list.id) return;
        event.preventDefault();
        sidebar.querySelectorAll(".is-drop-before, .is-drop-after").forEach((element) =>
          element.removeClasses(["is-drop-before", "is-drop-after"]));
        const bounds = selector.getBoundingClientRect();
        placeAfter = event.clientY >= bounds.top + bounds.height / 2;
        selector.addClass(placeAfter ? "is-drop-after" : "is-drop-before");
      });
      selector.addEventListener("drop", (event) => {
        event.preventDefault();
        const sourceId = this.draggedListId ?? event.dataTransfer?.getData("text/goal-tree-list");
        this.draggedListId = undefined;
        if (sourceId && sourceId !== list.id) void this.host.reorderList(sourceId, list.id, placeAfter);
      });
      const button = selector.createEl("button", { cls: "goal-tree-list-selector-main", attr: { type: "button" } });
      button.createSpan({ text: list.title });
      button.createSpan({ text: String(list.items.filter((item) => item.status !== "finished").length), cls: "goal-tree-count" });
      button.addEventListener("click", () => {
        this.selectedListId = list.id;
        void this.render(forest);
      });
      const orderMenu = selector.createEl("button", {
        cls: "goal-tree-list-selector-menu",
        attr: { type: "button", "aria-label": `Reorder ${list.title}` }
      });
      setIcon(orderMenu, "ellipsis");
      orderMenu.addEventListener("click", (event) => {
        const menu = new Menu();
        const previous = lists[listIndex - 1];
        const next = lists[listIndex + 1];
        menu.addItem((item) => item.setTitle("Move up").setIcon("arrow-up").setDisabled(!previous)
          .onClick(() => { if (previous) void this.host.reorderList(list.id, previous.id, false); }));
        menu.addItem((item) => item.setTitle("Move down").setIcon("arrow-down").setDisabled(!next)
          .onClick(() => { if (next) void this.host.reorderList(list.id, next.id, true); }));
        menu.showAtMouseEvent(event);
      });
    }
    const list = lists.find((candidate) => candidate.id === this.selectedListId);
    const panel = layout.createDiv({ cls: "goal-tree-list-panel" });
    if (!list) {
      panel.createDiv({ cls: "goal-tree-section-empty", text: "Create your first list." });
      return;
    }
    const listHeader = panel.createDiv({ cls: "goal-tree-list-header" });
    const listTitle = listHeader.createDiv();
    listTitle.createEl("h4", { text: list.title });
    listTitle.createSpan({ text: `${list.items.length} items · ${list.items.filter((item) => item.status === "finished").length} finished` });
    const listActions = listHeader.createDiv();
    new ButtonComponent(listActions).setButtonText("Add item").setIcon("plus").setCta().onClick(() =>
      new ListItemModal(this.app, undefined, (title, url, notes) => this.host.createListItem(list.id, title, url, notes)).open()
    );
    const more = listActions.createEl("button", { attr: { type: "button", "aria-label": "List actions" } });
    setIcon(more, "ellipsis-vertical");
    more.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle("Delete list").setIcon("trash-2").onClick(() => void this.host.deleteList(list.id)));
      menu.showAtMouseEvent(event);
    });
    const items = sortedListItems(list.items, this.host.settings.listsFinishedOrder);
    let finishedHeadingAdded = false;
    for (const item of items) {
      if (item.status === "finished" && !finishedHeadingAdded) {
        panel.createDiv({ cls: "goal-tree-list-divider", text: "Finished" });
        finishedHeadingAdded = true;
      }
      this.renderListItem(panel, list, item, forest);
    }
    if (items.length === 0) panel.createDiv({ cls: "goal-tree-section-empty", text: "This list is empty." });
  }

  private renderListItem(container: HTMLElement, list: GoalList, item: GoalListItem, forest: GoalForest): void {
    const linked = item.linkedGoalId ? forest.all.find((node) => node.stableId === item.linkedGoalId) : undefined;
    const status = linked?.metrics.status === "completed" ? "finished" : linked?.metrics.status === "in-progress" ? "in-progress" : item.status;
    const row = container.createDiv({ cls: `goal-tree-list-item status-${status}` });
    row.dataset.listItemId = item.id;
    row.dataset.listSection = status === "finished" ? "finished" : "active";
    const clearDropIndicators = (): void => {
      container.querySelectorAll(".goal-tree-list-item.is-drop-before, .goal-tree-list-item.is-drop-after")
        .forEach((element) => element.removeClasses(["is-drop-before", "is-drop-after"]));
    };
    const compatibleTarget = (targetId: string | undefined): GoalListItem | undefined => {
      const target = list.items.find((candidate) => candidate.id === targetId);
      if (!target || target.id === item.id) return undefined;
      return (target.status === "finished") === (item.status === "finished") ? target : undefined;
    };
    let dropAfter = false;
    const handle = row.createEl("button", {
      cls: "goal-tree-list-drag-handle",
      attr: {
        type: "button",
        draggable: "true",
        title: "Drag to reorder",
        "aria-label": `Reorder ${item.title}`
      }
    });
    setIcon(handle, "grip-vertical");
    handle.addEventListener("dragstart", (event) => {
      this.draggedListItemId = item.id;
      event.dataTransfer?.setData("text/goal-tree-list-item", item.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.addClass("is-dragging");
      handle.setAttr("aria-grabbed", "true");
    });
    handle.addEventListener("dragend", () => {
      this.draggedListItemId = undefined;
      row.removeClass("is-dragging");
      handle.setAttr("aria-grabbed", "false");
      clearDropIndicators();
    });
    row.addEventListener("dragover", (event) => {
      const source = list.items.find((candidate) => candidate.id === this.draggedListItemId);
      if (!source || source.id === item.id || (source.status === "finished") !== (item.status === "finished")) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearDropIndicators();
      dropAfter = event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      row.addClass(dropAfter ? "is-drop-after" : "is-drop-before");
    });
    row.addEventListener("dragleave", (event) => {
      if (!row.contains(event.relatedTarget as Node | null)) row.removeClasses(["is-drop-before", "is-drop-after"]);
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceId = this.draggedListItemId ?? event.dataTransfer?.getData("text/goal-tree-list-item");
      clearDropIndicators();
      this.draggedListItemId = undefined;
      if (sourceId && sourceId !== item.id) void this.host.reorderListItem(list.id, sourceId, item.id, dropAfter);
    });

    let longPressTimer: number | undefined;
    let touchDragging = false;
    let touchTargetId: string | undefined;
    let touchDropAfter = false;
    let touchStartX = 0;
    let touchStartY = 0;
    const finishTouchDrag = (event: PointerEvent, save: boolean): void => {
      if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
      longPressTimer = undefined;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      const targetId = touchTargetId;
      touchDragging = false;
      touchTargetId = undefined;
      row.removeClass("is-dragging");
      handle.setAttr("aria-grabbed", "false");
      clearDropIndicators();
      if (save && targetId) void this.host.reorderListItem(list.id, item.id, targetId, touchDropAfter);
    };
    handle.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      touchStartX = event.clientX;
      touchStartY = event.clientY;
      handle.setPointerCapture(event.pointerId);
      longPressTimer = window.setTimeout(() => {
        touchDragging = true;
        row.addClass("is-dragging");
        handle.setAttr("aria-grabbed", "true");
      }, 180);
    });
    handle.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse" || longPressTimer === undefined && !touchDragging) return;
      if (!touchDragging && Math.hypot(event.clientX - touchStartX, event.clientY - touchStartY) > 8) {
        if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
        return;
      }
      if (!touchDragging) return;
      event.preventDefault();
      clearDropIndicators();
      const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".goal-tree-list-item");
      const target = compatibleTarget(targetRow?.dataset.listItemId);
      if (!target || !targetRow) {
        touchTargetId = undefined;
        return;
      }
      touchTargetId = target.id;
      const bounds = targetRow.getBoundingClientRect();
      touchDropAfter = event.clientY >= bounds.top + bounds.height / 2;
      targetRow.addClass(touchDropAfter ? "is-drop-after" : "is-drop-before");
    });
    handle.addEventListener("pointerup", (event) => finishTouchDrag(event, touchDragging));
    handle.addEventListener("pointercancel", (event) => finishTouchDrag(event, false));

    const check = row.createEl("button", { cls: "goal-tree-list-check", attr: { type: "button", "aria-label": status === "finished" ? `Restore ${item.title}` : `Finish ${item.title}` } });
    setIcon(check, status === "finished" ? "check" : status === "in-progress" ? "play" : "circle");
    check.addEventListener("click", () => void this.host.setListItemStatus(list.id, item.id, status === "finished" ? "not-finished" : "finished"));
    const details = row.createDiv({ cls: "goal-tree-list-item-details" });
    const title = details.createEl(item.url ? "a" : "button", {
      text: item.title,
      attr: item.url ? { href: item.url, target: "_blank", rel: "noopener" } : { type: "button" }
    });
    if (!item.url) title.addEventListener("click", () => new ListItemModal(this.app, item, (nextTitle, url, notes) => this.host.updateListItem(list.id, item.id, nextTitle, url, notes)).open());
    if (item.notes) details.createDiv({ cls: "goal-tree-list-notes", text: item.notes });
    if (linked) details.createDiv({ cls: "goal-tree-list-link", text: `Linked to ${fullPathTitle(linked, forest)}` });
    else if (item.completedAt) details.createDiv({ cls: "goal-tree-list-link", text: `Finished ${formatDateLabel(item.completedAt.slice(0, 10))}` });
    const statusSelect = row.createEl("select", { attr: { "aria-label": `Status for ${item.title}` } });
    statusSelect.createEl("option", { value: "not-finished", text: "Not finished" });
    statusSelect.createEl("option", { value: "in-progress", text: "In progress" });
    statusSelect.createEl("option", { value: "finished", text: "Finished" });
    statusSelect.value = status;
    statusSelect.addEventListener("change", () => void this.host.setListItemStatus(list.id, item.id, statusSelect.value as ListItemStatus));
    const action = row.createEl("button", { cls: "goal-tree-list-action", attr: { type: "button" } });
    action.setText(linked ? "Open item" : "Add to Goal Tree");
    action.addEventListener("click", () => {
      if (linked) this.selectNode(linked);
      else new GoalItemModal(this.app, {
        nodes: forest.all,
        defaultType: "task",
        defaultTitle: item.title,
        allowedTypes: ["goal", "project", "task", "subtask"],
        defaultSeverity: this.host.settings.defaultSeverity,
        workdays: this.host.settings.workdays,
        onSubmit: (input) => this.host.createGoalFromList(list.id, item.id, input)
      }).open();
    });
    const menuButton = row.createEl("button", { cls: "goal-tree-list-more", attr: { type: "button", "aria-label": `More actions for ${item.title}` } });
    setIcon(menuButton, "ellipsis");
    menuButton.addEventListener("click", (event) => {
      const menu = new Menu();
      const sectionItems = sortedListItems(list.items, this.host.settings.listsFinishedOrder).filter((candidate) =>
        (candidate.status === "finished") === (item.status === "finished")
      );
      const position = sectionItems.findIndex((candidate) => candidate.id === item.id);
      const previous = position > 0 ? sectionItems[position - 1] : undefined;
      const next = position >= 0 && position < sectionItems.length - 1 ? sectionItems[position + 1] : undefined;
      menu.addItem((entry) => entry
        .setTitle("Move up")
        .setIcon("arrow-up")
        .setDisabled(!previous)
        .onClick(() => { if (previous) void this.host.reorderListItem(list.id, item.id, previous.id, false); }));
      menu.addItem((entry) => entry
        .setTitle("Move down")
        .setIcon("arrow-down")
        .setDisabled(!next)
        .onClick(() => { if (next) void this.host.reorderListItem(list.id, item.id, next.id, true); }));
      menu.addSeparator();
      menu.addItem((entry) => entry.setTitle("Edit").setIcon("pencil").onClick(() =>
        new ListItemModal(this.app, item, (title, url, notes) => this.host.updateListItem(list.id, item.id, title, url, notes)).open()
      ));
      if (linked) menu.addItem((entry) => entry.setTitle("Unlink from Goal Tree").setIcon("unlink").onClick(() => void this.host.unlinkListItem(list.id, item.id)));
      menu.addItem((entry) => entry.setTitle("Delete").setIcon("trash-2").onClick(() => void this.host.deleteListItem(list.id, item.id)));
      menu.showAtMouseEvent(event);
    });
  }

  private renderCalendarView(container: HTMLElement, forest: GoalForest): void {
    const actions = this.renderViewHeading(
      container,
      "calendar-days",
      "Calendar",
      "Plan anytime work, timed meetings, deadlines, and repeating actions."
    );
    const modes = actions.createDiv({ cls: "goal-tree-calendar-modes" });
    for (const mode of ["month", "week", "day"] as const) {
      const button = modes.createEl("button", {
        cls: this.calendarMode === mode ? "is-active" : "",
        text: label(mode),
        attr: { type: "button" }
      });
      button.addEventListener("click", () => {
        this.calendarMode = mode;
        void this.render(forest);
      });
    }
    if (this.calendarMode !== "month") {
      this.renderScheduleCalendar(container, forest);
      return;
    }
    const toolbar = container.createDiv({ cls: "goal-tree-calendar-toolbar" });
    const navigation = toolbar.createDiv({ cls: "goal-tree-calendar-navigation" });
    this.iconButton(navigation, "chevron-left", "Previous month", () => {
      this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() - 1, 1);
      void this.render(this.host.loadSnapshot());
    });
    new ButtonComponent(navigation).setButtonText("Today").onClick(() => {
      this.calendarMonth = startOfMonth(new Date());
      void this.render(this.host.loadSnapshot());
    });
    this.iconButton(navigation, "chevron-right", "Next month", () => {
      this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + 1, 1);
      void this.render(this.host.loadSnapshot());
    });
    toolbar.createEl("h3", { text: this.calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" }) });
    toolbar.createSpan({ text: "Planned, start, and due dates", cls: "goal-tree-calendar-hint" });

    const calendarShell = container.createDiv({ cls: "goal-tree-calendar-shell" });
    const calendar = calendarShell.createDiv({ cls: "goal-tree-calendar" });
    const weekStart = weekStartIndex(this.host.settings.weekStartsOn);
    const weekdays = rotate(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], weekStart);
    for (const weekday of weekdays) calendar.createDiv({ cls: "goal-tree-calendar-weekday", text: weekday });
    const first = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth(), 1);
    const offset = (first.getDay() - weekStart + 7) % 7;
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    const today = todayIso();
    const byDate = new Map<string, CalendarEntry[]>();
    for (const node of forest.all) {
      if (node.type === "area" || node.metrics.status === "cancelled" || node.archived) continue;
      addCalendarEntry(byDate, node.scheduled, node, "scheduled");
      if (node.start !== node.scheduled) addCalendarEntry(byDate, node.start, node, "start");
      if (node.due !== node.scheduled && node.due !== node.start) addCalendarEntry(byDate, node.due, node, "due");
    }
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const iso = localDateIso(date);
      const items = [...(byDate.get(iso) ?? [])].sort((a, b) =>
        (a.kind === "scheduled" ? a.node.scheduledStartTime ?? "99:99" : "99:99")
          .localeCompare(b.kind === "scheduled" ? b.node.scheduledStartTime ?? "99:99" : "99:99")
      );
      const cell = calendar.createDiv({
        cls: `goal-tree-calendar-day${date.getMonth() === this.calendarMonth.getMonth() ? "" : " is-outside"}${iso === today ? " is-today" : ""}`
      });
      cell.addEventListener("dragover", (event) => event.preventDefault());
      cell.addEventListener("drop", (event) => {
        event.preventDefault();
        const stableId = event.dataTransfer?.getData("text/goal-tree-id");
        const node = stableId ? forest.all.find((candidate) => candidate.stableId === stableId) : undefined;
        if (node && isWorkItem(node)) void this.host.scheduleGoal(node, iso);
      });
      const dayHeader = cell.createDiv({ cls: "goal-tree-calendar-day-header" });
      dayHeader.createSpan({ text: String(date.getDate()), cls: "goal-tree-calendar-day-number" });
      const add = dayHeader.createEl("button", { cls: "goal-tree-calendar-add", attr: { type: "button", "aria-label": `Add task on ${iso}` } });
      setIcon(add, "plus");
      add.addEventListener("click", () => this.openItemModal(forest, undefined, "task", iso));
      const events = cell.createDiv({ cls: "goal-tree-calendar-events" });
      for (const entry of items.slice(0, 4)) {
        const prefix = entry.kind === "scheduled"
          ? entry.node.scheduledStartTime ? `${formatClockTime(entry.node.scheduledStartTime, this.host.settings.timeFormat)} · ` : ""
          : entry.kind === "start" ? "Start · " : "Due · ";
        const event = events.createEl("button", {
          cls: `goal-tree-calendar-event type-${entry.node.type} health-${entry.node.metrics.health} severity-${entry.node.severity} kind-${entry.kind}`,
          text: `${prefix}${entry.node.title}`,
          attr: {
            type: "button",
            title: `${entry.node.title} — ${label(entry.node.metrics.status)}${scheduledTimeText(entry.node, this.host.settings.timeFormat) ? ` — ${scheduledTimeText(entry.node, this.host.settings.timeFormat)}` : ""}`
          }
        });
        if (isWorkItem(entry.node)) {
          event.draggable = true;
          event.addEventListener("dragstart", (dragEvent) =>
            dragEvent.dataTransfer?.setData("text/goal-tree-id", entry.node.stableId));
        }
        event.addEventListener("click", () => this.selectNode(entry.node));
      }
      if (items.length > 4) events.createSpan({ cls: "goal-tree-calendar-more", text: `+${items.length - 4} more` });
    }
  }

  private renderScheduleCalendar(container: HTMLElement, forest: GoalForest): void {
    const weekStart = weekStartIndex(this.host.settings.weekStartsOn);
    const start = this.calendarMode === "day" ? this.calendarDate : startOfLocalWeek(this.calendarDate, weekStart);
    const days = this.calendarMode === "day" ? [start] : Array.from({ length: 7 }, (_, index) => addLocalDays(start, index));
    const navigation = container.createDiv({ cls: "goal-tree-calendar-navigation goal-tree-calendar-schedule-navigation" });
    this.iconButton(navigation, "chevron-left", `Previous ${this.calendarMode}`, () => {
      this.calendarDate = addLocalDays(this.calendarDate, this.calendarMode === "day" ? -1 : -7);
      void this.render(forest);
    });
    new ButtonComponent(navigation).setButtonText("Today").onClick(() => {
      this.calendarDate = new Date();
      void this.render(forest);
    });
    this.iconButton(navigation, "chevron-right", `Next ${this.calendarMode}`, () => {
      this.calendarDate = addLocalDays(this.calendarDate, this.calendarMode === "day" ? 1 : 7);
      void this.render(forest);
    });
    navigation.createSpan({
      cls: "goal-tree-calendar-range",
      text: days.length === 1
        ? days[0].toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
        : `${days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${days.at(-1)?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    });
    const layout = container.createDiv({ cls: "goal-tree-schedule-layout" });
    const unscheduled = layout.createDiv({ cls: "goal-tree-unscheduled-panel" });
    unscheduled.createEl("h4", { text: "Unscheduled" });
    unscheduled.createEl("p", { text: "Drag a task onto a day." });
    const openWork = forest.all.filter((node) =>
      isActionableWorkItem(node) && !node.archived && node.metrics.status !== "completed" && node.metrics.status !== "cancelled"
    );
    const unscheduledItems = openWork.filter((node) => !node.scheduled && node.recurrence === "none");
    for (const node of unscheduledItems.slice(0, 30)) {
      const card = unscheduled.createDiv({ cls: "goal-tree-unscheduled-item", attr: { draggable: "true" } });
      card.dataset.goalId = node.stableId;
      card.createEl("strong", { text: node.title });
      card.createSpan({ text: ancestorTitles(node, forest) || label(node.type) });
      card.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/goal-tree-id", node.stableId));
      card.addEventListener("click", () => this.openItemModal(forest, undefined, undefined, undefined, node));
    }
    if (unscheduledItems.length === 0) unscheduled.createDiv({ cls: "goal-tree-section-empty", text: "No unscheduled tasks." });
    const board = layout.createDiv({ cls: `goal-tree-time-grid mode-${this.calendarMode}` });
    board.style.setProperty("--goal-tree-day-count", String(days.length));
    const header = board.createDiv({ cls: "goal-tree-time-grid-header" });
    header.createDiv({ cls: "goal-tree-time-grid-corner" });
    for (const day of days) {
      const iso = localDateIso(day);
      const dayHeader = header.createDiv({ cls: `goal-tree-time-grid-day${iso === todayIso() ? " is-today" : ""}` });
      const copy = dayHeader.createDiv();
      copy.createSpan({ text: day.toLocaleDateString("en-US", { weekday: "short" }) });
      copy.createEl("strong", { text: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }) });
      const add = dayHeader.createEl("button", { attr: { type: "button", "aria-label": `Add task on ${iso}` } });
      setIcon(add, "plus");
      add.addEventListener("click", () => this.openItemModal(forest, undefined, "task", iso));
    }
    for (const strip of [
      { label: "All-day", due: false },
      { label: "Due", due: true }
    ]) {
      const row = board.createDiv({ cls: `goal-tree-time-grid-strip${strip.due ? " is-due" : ""}` });
      row.createDiv({ cls: "goal-tree-time-grid-strip-label", text: strip.label });
      for (const day of days) {
        const iso = localDateIso(day);
        const nodes = strip.due
          ? forest.all.filter((node) => node.type !== "area" && !node.archived && node.metrics.status !== "completed" && node.due === iso)
          : openWork.filter((node) => node.scheduled === iso && !node.scheduledStartTime);
        this.renderCalendarStripCell(row, nodes, forest, iso, strip.due);
      }
    }
    const startHour = 8;
    const endHour = 20;
    const totalMinutes = (endHour - startHour) * 60;
    const timeBody = board.createDiv({ cls: "goal-tree-time-grid-body" });
    const timeAxis = timeBody.createDiv({ cls: "goal-tree-time-axis" });
    for (let hour = startHour; hour <= endHour; hour += 1) {
      timeAxis.createSpan({ text: formatClockTime(`${String(hour).padStart(2, "0")}:00`, this.host.settings.timeFormat) });
    }
    for (const day of days) {
      const iso = localDateIso(day);
      const column = timeBody.createDiv({ cls: `goal-tree-time-column${iso === todayIso() ? " is-today" : ""}` });
      column.addEventListener("dragover", (event) => event.preventDefault());
      column.addEventListener("drop", (event) => {
        event.preventDefault();
        const stableId = event.dataTransfer?.getData("text/goal-tree-id");
        const node = stableId ? forest.all.find((candidate) => candidate.stableId === stableId) : undefined;
        if (node) void this.host.scheduleGoal(node, iso);
      });
      column.addEventListener("dblclick", () => this.openItemModal(forest, undefined, "task", iso));
      const timed = openWork.filter((node) => node.scheduled === iso && Boolean(node.scheduledStartTime));
      for (const node of timed.sort((a, b) => (a.scheduledStartTime ?? "").localeCompare(b.scheduledStartTime ?? ""))) {
        const startMinutes = Math.max(startHour * 60, Math.min(endHour * 60, clockMinutes(node.scheduledStartTime ?? `${startHour}:00`)));
        const endMinutes = Math.max(startMinutes + 30, Math.min(endHour * 60, clockMinutes(node.scheduledEndTime ?? "") || startMinutes + (node.plannedMinutes ?? 60)));
        const item = column.createEl("button", {
          cls: `goal-tree-calendar-block health-${node.metrics.health}${node.isMeeting ? " is-meeting" : ""}`,
          attr: { type: "button", title: fullPathTitle(node, forest) }
        });
        item.style.setProperty("--goal-tree-calendar-top", `${(startMinutes - startHour * 60) / totalMinutes * 100}%`);
        item.style.setProperty("--goal-tree-calendar-height", `${Math.max(4.5, (endMinutes - startMinutes) / totalMinutes * 100)}%`);
        item.createEl("strong", { text: itemDisplayTitle(node) });
        item.createSpan({ text: `${formatClockTime(node.scheduledStartTime ?? "", this.host.settings.timeFormat)}–${formatClockTime(node.scheduledEndTime ?? "", this.host.settings.timeFormat)}` });
        item.draggable = true;
        item.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/goal-tree-id", node.stableId));
        item.addEventListener("click", () => this.selectNode(node));
      }
    }
  }

  private renderCalendarStripCell(
    container: HTMLElement,
    nodes: GoalNode[],
    forest: GoalForest,
    date: string,
    due: boolean
  ): void {
    const cell = container.createDiv({ cls: "goal-tree-time-grid-strip-cell" });
    cell.addEventListener("dragover", (event) => event.preventDefault());
    cell.addEventListener("drop", (event) => {
      if (due) return;
      event.preventDefault();
      const stableId = event.dataTransfer?.getData("text/goal-tree-id");
      const node = stableId ? forest.all.find((candidate) => candidate.stableId === stableId) : undefined;
      if (node) void this.host.scheduleGoal(node, date);
    });
    const unique = [...new Map(nodes.map((node) => [node.stableId, node])).values()];
    for (const node of unique) {
      const item = cell.createEl("button", { cls: `goal-tree-calendar-lane-item health-${node.metrics.health}`, attr: { type: "button" } });
      const icon = item.createSpan();
      setIcon(icon, due ? "flag" : node.recurrence !== "none" ? "repeat-2" : "circle");
      item.createSpan({ text: itemDisplayTitle(node) });
      if (!due && isWorkItem(node)) {
        item.draggable = true;
        item.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/goal-tree-id", node.stableId));
      }
      item.addEventListener("click", () => {
        this.selectNode(node);
      });
      item.setAttr("title", `${fullPathTitle(node, forest)} · ${date}`);
    }
  }

  private renderKanbanView(container: HTMLElement, forest: GoalForest): void {
    const range = kanbanRange(this.kanbanScope, this.kanbanDate, weekStartIndex(this.host.settings.weekStartsOn));
    const byId = new Map(forest.all.map((node) => [node.id, node]));
    const allWork = forest.all.filter((node) => {
      const matchesType = this.kanbanTypes.has(node.type);
      return matchesType &&
        !node.archived &&
        node.metrics.status !== "cancelled" &&
        (this.host.settings.kanbanShowCompleted || node.metrics.status !== "completed") &&
        this.matchesKanbanNode(node, byId);
    });
    const scheduled = allWork
      .filter((node) =>
        isPlannedInRange(node, range.start, range.end) ||
        (this.host.settings.kanbanShowUnscheduled && !node.start && !node.scheduled && !node.due)
      )
      .sort(compareKanbanItems);
    const unscheduledCount = allWork.filter((node) => !node.start && !node.scheduled && !node.due).length;
    const actions = this.renderViewHeading(
      container,
      "columns-3",
      `${kanbanScopeLabel(this.kanbanScope)} Kanban`,
      "Move actionable work through its status while keeping project and task context visible."
    );
    actions.createSpan({
      text: this.host.settings.kanbanShowUnscheduled
        ? `${scheduled.length} visible`
        : `${scheduled.length} visible · ${unscheduledCount} unscheduled`,
      cls: "goal-tree-context-pill"
    });

    const toolbar = container.createDiv({ cls: "goal-tree-kanban-toolbar" });
    const scopes = toolbar.createDiv({ cls: "goal-tree-scope-switch" });
    for (const scope of ["daily", "weekly", "monthly", "quarterly", "yearly"] as KanbanScope[]) {
      const button = scopes.createEl("button", {
        cls: this.kanbanScope === scope ? "is-active" : "",
        text: kanbanScopeLabel(scope),
        attr: { type: "button" }
      });
      button.addEventListener("click", () => {
        this.kanbanScope = scope;
        void this.render(this.host.loadSnapshot());
      });
    }
    const types = toolbar.createDiv({ cls: "goal-tree-kanban-type-filter", attr: { "aria-label": "Visible item types" } });
    for (const type of ["project", "task", "subtask"] as GoalType[]) {
      const button = types.createEl("button", {
        text: label(type),
        cls: this.kanbanTypes.has(type) ? "is-active" : "",
        attr: { type: "button", "aria-pressed": String(this.kanbanTypes.has(type)) }
      });
      button.addEventListener("click", () => {
        if (this.kanbanTypes.has(type)) {
          if (this.kanbanTypes.size === 1) return;
          this.kanbanTypes.delete(type);
        } else this.kanbanTypes.add(type);
        void this.render(this.host.loadSnapshot());
      });
    }
    const navigation = toolbar.createDiv({ cls: "goal-tree-kanban-date-navigation" });
    this.iconButton(navigation, "chevron-left", `Previous ${kanbanScopeUnit(this.kanbanScope)}`, () => {
      this.kanbanDate = shiftKanbanDate(this.kanbanDate, this.kanbanScope, -1);
      void this.render(this.host.loadSnapshot());
    });
    new ButtonComponent(navigation).setButtonText("Today").onClick(() => {
      this.kanbanDate = new Date();
      void this.render(this.host.loadSnapshot());
    });
    this.iconButton(navigation, "chevron-right", `Next ${kanbanScopeUnit(this.kanbanScope)}`, () => {
      this.kanbanDate = shiftKanbanDate(this.kanbanDate, this.kanbanScope, 1);
      void this.render(this.host.loadSnapshot());
    });
    navigation.createSpan({ text: range.label, cls: "goal-tree-kanban-range" });

    const board = container.createDiv({ cls: "goal-tree-kanban-board" });
    const columns: Array<{ status: ManualStatus; label: string; icon: string }> = [
      { status: "not-started", label: "Not Started", icon: "circle" },
      { status: "in-progress", label: "In Progress", icon: "play" },
      { status: "completed", label: "Completed", icon: "circle-check" }
    ];
    for (const column of columns) {
      const items = scheduled.filter((node) => node.metrics.status === column.status);
      const columnEl = board.createDiv({ cls: `goal-tree-kanban-column status-${column.status}` });
      columnEl.addEventListener("dragover", (event) => event.preventDefault());
      columnEl.addEventListener("drop", (event) => {
        event.preventDefault();
        const node = forest.all.find((item) => item.stableId === this.draggedKanbanId);
        this.draggedKanbanId = undefined;
        if (node && isActionableWorkItem(node)) void this.host.setGoalStatus(node, column.status);
      });
      const header = columnEl.createDiv({ cls: "goal-tree-kanban-header" });
      const icon = header.createSpan();
      setIcon(icon, column.icon);
      header.createEl("h4", { text: column.label });
      header.createSpan({ text: String(items.length), cls: "goal-tree-count" });
      const cards = columnEl.createDiv({ cls: "goal-tree-kanban-cards" });
      if (this.host.settings.kanbanGroupByParent) this.renderKanbanColumnItems(cards, items, forest);
      else for (const node of items) this.renderKanbanCard(cards, node, forest);
      const add = columnEl.createEl("button", { cls: "goal-tree-kanban-add", attr: { type: "button" } });
      setIcon(add, "plus");
      add.createSpan({ text: "Add item" });
      add.addEventListener("click", () => this.openItemModal(forest, undefined, "task", range.start));
    }
  }

  private renderKanbanColumnItems(container: HTMLElement, items: GoalNode[], forest: GoalForest): void {
    const groups = new Map<string, { root: GoalNode; leaves: GoalNode[] }>();
    for (const item of items) {
      const root = kanbanHierarchyRoot(item, forest.all);
      const existing = groups.get(root.stableId);
      if (existing) existing.leaves.push(item);
      else groups.set(root.stableId, { root, leaves: [item] });
    }

    for (const group of groups.values()) {
      if (group.leaves.length === 1 && group.leaves[0].stableId === group.root.stableId) {
        this.renderKanbanCard(container, group.root, forest);
      } else {
        this.renderKanbanGroup(container, group.root, group.leaves, forest);
      }
    }
  }

  private renderKanbanGroup(
    container: HTMLElement,
    root: GoalNode,
    leaves: GoalNode[],
    forest: GoalForest
  ): void {
    const collapsed = this.collapsedKanbanGroups.has(root.stableId);
    const group = container.createDiv({ cls: `goal-tree-kanban-group health-${root.metrics.health}${collapsed ? " is-collapsed" : ""}` });
    const header = group.createDiv({ cls: "goal-tree-kanban-group-header" });
    const toggle = header.createEl("button", {
      cls: "goal-tree-kanban-group-toggle",
      attr: { type: "button", "aria-label": collapsed ? `Expand ${root.title}` : `Collapse ${root.title}` }
    });
    setIcon(toggle, collapsed ? "chevron-right" : "chevron-down");
    toggle.addEventListener("click", () => {
      if (collapsed) this.collapsedKanbanGroups.delete(root.stableId);
      else this.collapsedKanbanGroups.add(root.stableId);
      void this.render(this.host.loadSnapshot());
    });

    const details = header.createDiv({ cls: "goal-tree-kanban-group-details" });
    const eyebrow = details.createDiv({ cls: "goal-tree-kanban-group-eyebrow" });
    const typeIcon = eyebrow.createSpan();
    setIcon(typeIcon, iconForType(root.type));
    eyebrow.createSpan({ text: `${label(root.type)} group` });
    const title = details.createEl("button", { cls: "goal-tree-kanban-group-title", text: root.title, attr: { type: "button" } });
    title.addEventListener("click", () => this.selectNode(root));
    const path = ancestorTitles(root, forest);
    if (path) details.createDiv({ cls: "goal-tree-kanban-group-path", text: path });

    const remaining = actionableWorkDescendants(root).filter(
      (node) => !node.archived && node.metrics.status !== "completed" && node.metrics.status !== "cancelled"
    ).length;
    const stats = header.createDiv({ cls: "goal-tree-kanban-group-stats" });
    stats.createSpan({ cls: `goal-tree-chip status-${root.metrics.status}`, text: label(root.metrics.status) });
    stats.createSpan({ text: `${root.metrics.progress}%` });
    stats.createSpan({ text: `${remaining} remaining` });

    if (collapsed) {
      group.createDiv({ cls: "goal-tree-kanban-group-collapsed", text: `${leaves.length} action${leaves.length === 1 ? "" : "s"} in this column` });
      return;
    }

    const leafIds = new Set(leaves.map((node) => node.stableId));
    const children = group.createDiv({ cls: "goal-tree-kanban-group-children" });
    this.renderKanbanBranches(children, root, leafIds, forest);
  }

  private renderKanbanBranches(
    container: HTMLElement,
    parent: GoalNode,
    leafIds: Set<string>,
    forest: GoalForest
  ): void {
    for (const child of parent.children) {
      if (!isWorkItem(child) || child.archived || !branchContainsLeaf(child, leafIds)) continue;
      const branch = container.createDiv({ cls: "goal-tree-kanban-branch" });
      if (leafIds.has(child.stableId)) {
        this.renderKanbanCard(branch, child, forest, true);
        continue;
      }

      const collapsed = this.collapsedKanbanGroups.has(child.stableId);
      const header = branch.createDiv({ cls: "goal-tree-kanban-branch-header" });
      const toggle = header.createEl("button", {
        cls: "goal-tree-kanban-branch-toggle",
        attr: { type: "button", "aria-label": collapsed ? `Expand ${child.title}` : `Collapse ${child.title}` }
      });
      setIcon(toggle, collapsed ? "chevron-right" : "chevron-down");
      toggle.addEventListener("click", () => {
        if (collapsed) this.collapsedKanbanGroups.delete(child.stableId);
        else this.collapsedKanbanGroups.add(child.stableId);
        void this.render(this.host.loadSnapshot());
      });
      const childTitle = header.createEl("button", {
        cls: "goal-tree-kanban-branch-title",
        text: child.title,
        attr: { type: "button" }
      });
      childTitle.addEventListener("click", () => this.selectNode(child));
      header.createSpan({ cls: "goal-tree-kanban-branch-type", text: label(child.type) });
      header.createSpan({ cls: `goal-tree-chip status-${child.metrics.status}`, text: label(child.metrics.status) });
      header.createSpan({ cls: "goal-tree-kanban-branch-progress", text: `${child.metrics.progress}%` });
      if (!collapsed) {
        const descendants = branch.createDiv({ cls: "goal-tree-kanban-branch-children" });
        this.renderKanbanBranches(descendants, child, leafIds, forest);
      }
    }
  }

  private renderKanbanCard(container: HTMLElement, node: GoalNode, forest: GoalForest, nested = false): void {
    const automatic = !isActionableWorkItem(node);
    const card = container.createDiv({ cls: `goal-tree-kanban-card health-${node.metrics.health}${nested ? " is-nested" : ""}` });
    card.setAttr("draggable", String(!automatic));
    if (!automatic) {
      card.addEventListener("dragstart", () => {
        this.draggedKanbanId = node.stableId;
        card.addClass("is-dragging");
      });
      card.addEventListener("dragend", () => {
        this.draggedKanbanId = undefined;
        card.removeClass("is-dragging");
      });
      card.addEventListener("dragover", (event) => {
        if (this.draggedKanbanId && this.draggedKanbanId !== node.stableId) event.preventDefault();
      });
      card.addEventListener("drop", (event) => {
        const moved = forest.all.find((item) => item.stableId === this.draggedKanbanId);
        if (!moved || moved.stableId === node.stableId) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = card.getBoundingClientRect();
        const placeAfter = event.clientY > bounds.top + bounds.height / 2;
        this.draggedKanbanId = undefined;
        void this.host.reorderGoal(moved, node, placeAfter);
      });
    }
    const top = card.createDiv({ cls: "goal-tree-kanban-card-top" });
    const labels = top.createDiv({ cls: "goal-tree-kanban-labels" });
    labels.createSpan({ cls: `goal-tree-kanban-type type-${node.type}`, text: label(node.type) });
    if (this.host.settings.kanbanShowSeverity) {
      labels.createSpan({ cls: `goal-tree-kanban-severity severity-${node.severity}`, text: label(node.severity) });
    }
    if (node.recurrence === "weekly-target" && node.recurrenceTarget) {
      labels.createSpan({
        cls: "goal-tree-kanban-occurrence",
        text: `${weeklyTargetCompleted(node, forest)}/${node.recurrenceTarget} this week`
      });
    }
    if (node.metrics.health === "overdue") top.createSpan({ cls: "goal-tree-kanban-overdue", text: "Overdue" });
    const title = card.createEl("button", { cls: "goal-tree-kanban-title", text: itemDisplayTitle(node), attr: { type: "button" } });
    title.addEventListener("click", () => this.selectNode(node));
    const path = ancestorTitles(node, forest);
    if (path && !nested && this.host.settings.kanbanShowParentPath) {
      card.createDiv({ cls: "goal-tree-kanban-path", text: path });
    }
    const footer = card.createDiv({ cls: "goal-tree-kanban-footer" });
    const planningText = kanbanPlanningText(node, this.host.settings.kanbanShowDueDate);
    if (planningText) footer.createSpan({ text: planningText });
    if (this.host.settings.kanbanShowTime) {
      const time = scheduledTimeText(node, this.host.settings.timeFormat);
      if (time) footer.createSpan({ text: time });
    }
    const action = footer.createEl("button", {
      cls: "goal-tree-kanban-action",
      text: automatic ? "Auto" : nextStatusLabel(node.metrics.status),
      attr: { type: "button" }
    });
    action.disabled = automatic;
    if (!automatic) action.addEventListener("click", () => void this.host.setGoalStatus(node, nextStatus(node.metrics.status)));
  }

  private renderReviewView(container: HTMLElement, forest: GoalForest): void {
    const actions = this.renderViewHeading(
      container,
      "chart-no-axes-column-increasing",
      "Review",
      "Understand what needs attention and keep a clear history of completed work."
    );
    const modeSwitch = actions.createDiv({ cls: "goal-tree-review-mode" });
    for (const mode of ["attention", "completed"] as const) {
      const button = modeSwitch.createEl("button", {
        text: mode === "attention" ? "Needs attention" : "Completed work",
        cls: this.reviewMode === mode ? "is-active" : "",
        attr: { type: "button" }
      });
      button.addEventListener("click", () => { this.reviewMode = mode; void this.render(forest); });
    }
    const range = dateRangeFor(
      this.reviewRange,
      todayIso(),
      weekStartIndex(this.host.settings.weekStartsOn),
      this.customRangeStart,
      this.customRangeEnd
    );
    this.renderReviewToolbar(container, forest);
    const inRange = (value: string | undefined): boolean => Boolean(
      value && (!range.start || value.slice(0, 10) >= range.start) && (!range.end || value.slice(0, 10) <= range.end)
    );
    const visible = forest.all.filter((node) => this.reviewTypes.has(node.type) && this.matchesNode(node));
    const active = visible.filter((node) => !node.archived && node.metrics.status !== "completed" && node.metrics.status !== "cancelled");
    const reviewStats = container.createDiv({ cls: "goal-tree-review-stats" });
    this.renderReviewStat(reviewStats, "Overdue", active.filter((node) => node.metrics.health === "overdue").length, "triangle-alert", "is-danger");
    this.renderReviewStat(reviewStats, "At risk", active.filter((node) => node.metrics.health === "at-risk").length, "shield-alert", "is-warning");
    this.renderReviewStat(reviewStats, "In progress", active.filter((node) => node.metrics.status === "in-progress").length, "play", "is-progress");
    this.renderReviewStat(reviewStats, "Completed in range", visible.filter((node) => node.metrics.status === "completed" && inRange(completionDateTime(node))).length, "circle-check-big", "is-success");
    const items = this.reviewMode === "completed"
      ? visible.filter((node) => node.metrics.status === "completed" && inRange(completionDateTime(node)))
        .sort((a, b) => completionDateTime(b).localeCompare(completionDateTime(a)))
      : visible.filter((node) => !node.archived && node.metrics.status !== "completed" &&
        (node.metrics.health === "overdue" || node.metrics.health === "at-risk"))
        .sort(compareAttention);

    const section = container.createDiv({ cls: "goal-tree-review-section goal-tree-review-clean" });
    const sectionHeading = section.createDiv({ cls: "goal-tree-section-heading" });
    sectionHeading.createEl("h3", { text: this.reviewMode === "completed" ? "Completed work" : "Needs attention" });
    sectionHeading.createSpan({ text: `${items.length} item${items.length === 1 ? "" : "s"}`, cls: "goal-tree-count-badge" });
    if (items.length === 0) {
      section.createDiv({ cls: "goal-tree-section-empty", text: this.reviewMode === "completed"
        ? "No completed work matches these filters."
        : "Nothing needs attention." });
      return;
    }
    const list = section.createDiv({ cls: "goal-tree-review-list" });
    for (const node of items.slice(0, 100)) {
      const row = list.createDiv({ cls: `goal-tree-review-row health-${node.metrics.health}` });
      const marker = row.createSpan({ cls: "goal-tree-review-row-marker" });
      setIcon(marker, this.reviewMode === "completed" ? "circle-check-big" : node.metrics.health === "overdue" ? "triangle-alert" : "shield-alert");
      const details = row.createDiv({ cls: "goal-tree-review-row-details" });
      const title = details.createEl("button", { text: node.title, attr: { type: "button" } });
      title.addEventListener("click", () => this.selectNode(node));
      const meta = details.createDiv({ cls: "goal-tree-review-row-meta" });
      meta.createSpan({ text: label(node.type) });
      meta.createSpan({ text: ancestorTitles(node, forest) || "Root" });
      meta.createSpan({ text: this.reviewMode === "completed" ? `Completed ${formatCompletedDate(node)}` : healthReason(node) });
      const actions = row.createDiv({ cls: "goal-tree-review-row-actions" });
      if (this.reviewMode === "completed" && isActionableWorkItem(node)) {
        const reopen = actions.createEl("button", { text: "Reopen", attr: { type: "button" } });
        reopen.addEventListener("click", () => void this.host.setGoalStatus(node, "not-started"));
      } else if (this.reviewMode === "attention") {
        const plan = actions.createEl("button", { text: "Plan", attr: { type: "button" } });
        plan.addEventListener("click", () => this.openItemModal(forest, undefined, undefined, undefined, node));
      }
    }
  }

  private renderReviewToolbar(container: HTMLElement, forest: GoalForest): void {
    const toolbar = container.createDiv({ cls: "goal-tree-review-toolbar" });
    const types = toolbar.createDiv({ cls: "goal-tree-review-type-filter" });
    for (const type of ["goal", "project", "task", "subtask"] as GoalType[]) {
      const button = types.createEl("button", {
        text: label(type),
        cls: this.reviewTypes.has(type) ? "is-active" : "",
        attr: { type: "button", "aria-pressed": String(this.reviewTypes.has(type)) }
      });
      button.addEventListener("click", () => {
        if (this.reviewTypes.has(type)) {
          if (this.reviewTypes.size === 1) return;
          this.reviewTypes.delete(type);
        } else this.reviewTypes.add(type);
        void this.render(forest);
      });
    }
    if (this.reviewMode !== "completed") return;
    const select = toolbar.createEl("select", { attr: { "aria-label": "Completed period" } });
    for (const value of ["today", "week", "month", "quarter", "year", "all", "custom"] as ReviewRange[]) {
      select.createEl("option", { value, text: label(value) });
    }
    select.value = this.reviewRange;
    select.addEventListener("change", () => { this.reviewRange = select.value as ReviewRange; void this.render(forest); });
    if (this.reviewRange === "custom") {
      const start = toolbar.createEl("input");
      start.type = "date";
      start.value = this.customRangeStart;
      start.addEventListener("change", () => {
        this.customRangeStart = start.value || todayIso();
        void this.render(forest);
      });
      const end = toolbar.createEl("input");
      end.type = "date";
      end.value = this.customRangeEnd;
      end.addEventListener("change", () => {
        this.customRangeEnd = end.value || todayIso();
        void this.render(forest);
      });
    }
  }

  private renderReviewStat(
    container: HTMLElement,
    title: string,
    value: number,
    iconName: string,
    stateClass: string
  ): void {
    const stat = container.createDiv({ cls: `goal-tree-review-stat ${stateClass}` });
    const icon = stat.createSpan({ cls: "goal-tree-review-stat-icon" });
    setIcon(icon, iconName);
    const copy = stat.createDiv();
    copy.createEl("strong", { text: String(value) });
    copy.createSpan({ text: title });
  }

  private renderProgress(container: HTMLElement, progress: number, compact = false): void {
    const row = container.createDiv({ cls: `goal-tree-progress-row${compact ? " is-compact" : ""}` });
    const track = row.createDiv({ cls: "goal-tree-progress-track" });
    const fill = track.createDiv({ cls: "goal-tree-progress-fill" });
    fill.style.setProperty("--goal-tree-progress", `${progress}%`);
    if (!compact) row.createSpan({ text: `${progress}%`, cls: "goal-tree-progress-label" });
  }

  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createDiv({ cls: "goal-tree-empty" });
    const icon = empty.createDiv({ cls: "goal-tree-empty-icon" });
    setIcon(icon, "network");
    empty.createEl("h3", { text: "Build your first goal tree" });
    empty.createEl("p", { text: "Start with a life area, or create the starter example based on Religion, Family, Self Development, Work, and Finance." });
    const buttons = empty.createDiv({ cls: "goal-tree-empty-actions" });
    new ButtonComponent(buttons).setButtonText("Create first area").setCta().onClick(() =>
      this.openItemModal({ roots: [], all: [], diagnostics: [] }, undefined, "area")
    );
    new ButtonComponent(buttons).setButtonText("Create starter tree").onClick(() => void this.host.createStarterTree());
  }

  private openItemModal(
    forest: GoalForest,
    defaultParentId?: string,
    defaultType?: GoalType,
    defaultScheduled?: string,
    existing?: GoalNode
  ): void {
    const parent = defaultParentId ? forest.all.find((node) => node.id === defaultParentId) : undefined;
    new GoalItemModal(this.app, {
      nodes: forest.all,
      existing,
      defaultParentId,
      defaultType: defaultType ?? (parent ? childTypeFor(parent.type) : "area"),
      defaultScheduled,
      defaultSeverity: this.host.settings.defaultSeverity,
      workdays: this.host.settings.workdays,
      onSubmit: async (input) => {
        if (existing) await this.host.updateGoal(existing, input);
        else await this.host.createGoal(input);
      }
    }).open();
  }

  private openNodeMenu(event: MouseEvent, node: GoalNode, forest: GoalForest): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Open note").setIcon("file-text").onClick(() => void this.host.openGoal(node)));
    menu.addItem((item) => item.setTitle("Edit item").setIcon("pencil").onClick(() => this.openItemModal(forest, undefined, undefined, undefined, node)));
    menu.addItem((item) => item.setTitle("Add child").setIcon("plus").onClick(() =>
      this.openItemModal(forest, node.id, childTypeFor(node.type))
    ));
    menu.addItem((item) => item.setTitle("Duplicate").setIcon("copy").onClick(() => void this.host.duplicateGoal(node)));
    if (node.recurrence !== "none") {
      menu.addItem((item) => item.setTitle("Stop repeating").setIcon("calendar-x").onClick(() =>
        void this.host.stopGoalRecurrence(node)
      ));
    }
    if (isWorkItem(node) && isLeaf(node)) {
      menu.addSeparator();
      const statuses: Array<{ status: ManualStatus; title: string; icon: string }> = [
        { status: "not-started", title: "Mark not started", icon: "circle" },
        { status: "in-progress", title: "Mark in progress", icon: "play" },
        { status: "completed", title: "Mark completed", icon: "check" }
      ];
      for (const definition of statuses) {
        menu.addItem((item) => item.setTitle(definition.title).setIcon(definition.icon).onClick(() =>
          void this.host.setGoalStatus(node, definition.status)
        ));
      }
    }
    if (node.metrics.status === "completed") {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(node.archived ? "Restore from archive" : "Archive completed item")
        .setIcon("archive")
        .onClick(() => void this.host.setGoalArchived(node, !node.archived)));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Delete").setIcon("trash-2").onClick(() => this.requestDelete(node, forest)));
    menu.showAtMouseEvent(event);
  }

  private async toggleCompleted(node: GoalNode): Promise<void> {
    if (!isWorkItem(node) || !isLeaf(node)) {
      new Notice("Only leaf tasks and subtasks can be completed manually.");
      return;
    }
    await this.host.setGoalStatus(node, node.metrics.status === "completed" ? "not-started" : "completed");
  }

  private matchesTree(node: GoalNode): boolean {
    return this.matchesNode(node) || node.children.some((child) => this.matchesTree(child));
  }

  private matchesNode(node: GoalNode): boolean {
    if (!this.filter) return true;
    return `${node.title} ${node.type} ${node.severity} ${node.metrics.status} ${node.metrics.health}`
      .toLowerCase()
      .includes(this.filter);
  }

  private matchesKanbanNode(node: GoalNode, byId: Map<string, GoalNode>): boolean {
    if (!this.filter) return true;
    const visited = new Set<string>();
    let current: GoalNode | undefined = node;
    while (current && !visited.has(current.stableId)) {
      if (this.matchesNode(current)) return true;
      visited.add(current.stableId);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  }

  private iconButton(
    container: HTMLElement,
    iconName: string,
    ariaLabel: string,
    onClick: () => void
  ): HTMLButtonElement {
    const button = container.createEl("button", {
      cls: "goal-tree-icon-button",
      attr: { type: "button", "aria-label": ariaLabel, title: ariaLabel }
    });
    setIcon(button, iconName);
    button.addEventListener("click", onClick);
    return button;
  }

}

interface GoalItemModalOptions {
  nodes: GoalNode[];
  existing?: GoalNode;
  defaultParentId?: string;
  defaultType: GoalType;
  defaultTitle?: string;
  defaultScheduled?: string;
  defaultSeverity: GoalSeverity;
  workdays: number[];
  allowedTypes?: GoalType[];
  onSubmit: (input: EditGoalInput) => Promise<void>;
}

interface CalendarEntry {
  node: GoalNode;
  kind: "start" | "due" | "scheduled";
}

interface KanbanDateRange {
  start: string;
  end: string;
  label: string;
}

class GoalItemModal extends Modal {
  private titleValue: string;
  private notesValue: string;
  private typeValue: GoalType;
  private parentValue?: string;
  private startValue: string;
  private scheduledValue: string;
  private scheduledStartTimeValue: string;
  private scheduledEndTimeValue: string;
  private timeModeValue: "anytime" | "specific";
  private isMeetingValue: boolean;
  private dueValue: string;
  private severityValue: GoalSeverity;
  private repeatEnabledValue: boolean;
  private recurrenceValue: RecurrenceRule;
  private recurrenceIntervalValue: string;
  private recurrenceWeekdaysValue: number[];
  private recurrenceTargetValue: string;
  private recurrenceEndModeValue: "manual" | "date";
  private recurrenceEndValue: string;
  private typeSelect?: DropdownComponent;
  private parentSelect?: DropdownComponent;
  private startSettingEl?: HTMLElement;
  private scheduledSettingEl?: HTMLElement;
  private dueSettingEl?: HTMLElement;
  private severitySettingEl?: HTMLElement;
  private scheduledStartTimeSettingEl?: HTMLElement;
  private scheduledEndTimeSettingEl?: HTMLElement;
  private meetingSettingEl?: HTMLElement;
  private repeatToggleSettingEl?: HTMLElement;
  private timeModeSettingEl?: HTMLElement;
  private detailsEl?: HTMLDetailsElement;
  private detailsSummaryEl?: HTMLElement;
  private recurrenceSettingEl?: HTMLElement;
  private recurrenceIntervalSettingEl?: HTMLElement;
  private recurrenceWeekdaysSettingEl?: HTMLElement;
  private recurrenceTargetSettingEl?: HTMLElement;
  private recurrenceEndModeSettingEl?: HTMLElement;
  private recurrenceEndSettingEl?: HTMLElement;
  private recurrenceSummaryEl?: HTMLElement;

  constructor(app: App, private readonly options: GoalItemModalOptions) {
    super(app);
    const existing = options.existing;
    this.titleValue = existing?.title ?? options.defaultTitle ?? "";
    this.notesValue = existing?.notes ?? "";
    this.typeValue = existing?.type ?? options.defaultType;
    this.parentValue = existing?.parentId ?? options.defaultParentId;
    this.startValue = existing?.start ?? options.defaultScheduled ?? "";
    this.scheduledValue = existing?.scheduled ?? options.defaultScheduled ?? "";
    this.scheduledStartTimeValue = existing?.scheduledStartTime ?? "";
    this.scheduledEndTimeValue = existing?.scheduledEndTime ?? "";
    this.timeModeValue = existing?.scheduledStartTime || existing?.scheduledEndTime ? "specific" : "anytime";
    this.isMeetingValue = existing?.isMeeting ?? false;
    this.dueValue = existing?.due ?? "";
    this.severityValue = existing?.severity ?? options.defaultSeverity;
    this.repeatEnabledValue = Boolean(existing && existing.recurrence !== "none");
    this.recurrenceValue = existing?.recurrence ?? "none";
    this.recurrenceIntervalValue = String(existing?.recurrenceInterval ?? 1);
    this.recurrenceWeekdaysValue = existing?.recurrenceWeekdays?.length
      ? [...existing.recurrenceWeekdays]
      : [...options.workdays];
    this.recurrenceTargetValue = String(existing?.recurrenceTarget ?? 2);
    this.recurrenceEndModeValue = existing?.recurrenceEnd ? "date" : "manual";
    this.recurrenceEndValue = existing?.recurrenceEnd ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("goal-tree-modal");
    this.modalEl.addClasses(["goal-tree-modal-shell", "goal-tree-modal-wide"]);
    this.updateModalTitle();
    new Setting(contentEl).setName("Title").setDesc("Use a clear outcome or action.").addText((text) => {
      text.setPlaceholder("Example: Read one page").setValue(this.titleValue).onChange((value) => { this.titleValue = value; });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    new Setting(contentEl).setName("Type").setDesc("Type controls the allowed parents.").addDropdown((dropdown) => {
      this.typeSelect = dropdown;
      const allowedTypes = this.options.allowedTypes ?? ["area", "goal", "project", "task", "subtask"];
      for (const type of allowedTypes) dropdown.addOption(type, type === "area" ? "Life area" : label(type));
      if (!allowedTypes.includes(this.typeValue)) this.typeValue = allowedTypes[0] ?? "task";
      dropdown.setValue(this.typeValue).onChange((value) => {
          this.typeValue = value as GoalType;
          if (!isWorkType(this.typeValue)) {
            this.repeatEnabledValue = false;
            this.recurrenceValue = "none";
          }
          this.updateModalTitle();
          this.refreshParentOptions();
          this.refreshFieldVisibility();
        });
    });
    new Setting(contentEl).setName("Parent").setDesc("Only compatible parents are shown.").addDropdown((dropdown) => {
      this.parentSelect = dropdown;
      dropdown.onChange((value) => { this.parentValue = value || undefined; });
      this.refreshParentOptions();
    });
    new Setting(contentEl).setName("Notes").setDesc("Optional context. You can edit this later in the inspector.").addTextArea((text) => {
      text.setPlaceholder("Add a short note…").setValue(this.notesValue).onChange((value) => { this.notesValue = value; });
    });
    const repeatToggle = new Setting(contentEl)
      .setName("Repeating task")
      .setDesc("Makes this Task or Subtask behave as a habit.")
      .addToggle((toggle) => toggle.setValue(this.repeatEnabledValue).onChange((value) => {
        this.repeatEnabledValue = value;
        if (value && this.recurrenceValue === "none") this.recurrenceValue = "weekly-target";
        if (!value) this.recurrenceValue = "none";
        this.refreshFieldVisibility();
      }));
    this.repeatToggleSettingEl = repeatToggle.settingEl;
    this.startSettingEl = this.addDateSetting("Start date", "First day this Goal, Project, Task, or Subtask is active.", this.startValue, (value) => { this.startValue = value; });
    this.scheduledSettingEl = this.addDateSetting("Planned day", "Optional exact day to do this one-time Task or Subtask.", this.scheduledValue, (value) => { this.scheduledValue = value; });
    this.dueSettingEl = this.addDateSetting("Due date", "Optional deadline. Leave blank when it is unknown.", this.dueValue, (value) => { this.dueValue = value; });
    const meetingSetting = new Setting(contentEl)
      .setName("Meeting")
      .setDesc("Treat this Task or Subtask as a scheduled meeting.")
      .addToggle((toggle) => toggle.setValue(this.isMeetingValue).onChange((value) => { this.isMeetingValue = value; }));
    this.meetingSettingEl = meetingSetting.settingEl;
    const severitySetting = new Setting(contentEl).setName("Severity").setDesc("Urgency or consequence. Higher-severity children have more influence on parent progress.").addDropdown((dropdown) => {
      dropdown
        .addOption("low", "Low")
        .addOption("medium", "Medium")
        .addOption("high", "High")
        .addOption("critical", "Critical")
        .setValue(this.severityValue)
        .onChange((value) => { this.severityValue = value as GoalSeverity; });
    });
    this.severitySettingEl = severitySetting.settingEl;
    const details = contentEl.createEl("details", { cls: "goal-tree-modal-details" });
    this.detailsEl = details;
    this.detailsSummaryEl = details.createEl("summary", { text: "Schedule and recurrence" });
    const recurrenceSetting = new Setting(details).setName("Repeat").setDesc("Leave this off for one-time work.").addDropdown((dropdown) =>
      dropdown
        .addOption("daily", "Every day")
        .addOption("weekdays", "Workdays")
        .addOption("specific-weekdays", "Selected weekdays")
        .addOption("weekly-target", "Times per week")
        .addOption("weekly", "Every week")
        .addOption("monthly", "Every month")
        .setValue(this.recurrenceValue)
        .onChange((value) => {
          this.recurrenceValue = value as RecurrenceRule;
          this.repeatEnabledValue = this.recurrenceValue !== "none";
          this.refreshFieldVisibility();
        })
    );
    this.recurrenceSettingEl = recurrenceSetting.settingEl;
    this.recurrenceIntervalSettingEl = this.addNumberSetting(details, "Repeat every", "Number of weeks or months.", this.recurrenceIntervalValue, (value) => { this.recurrenceIntervalValue = value; }, 1);
    this.recurrenceWeekdaysSettingEl = this.addWeekdaySetting(details);
    this.recurrenceTargetSettingEl = this.addNumberSetting(
      details,
      "Times per week",
      "Creates this many flexible occurrences for the current week.",
      this.recurrenceTargetValue,
      (value) => {
        this.recurrenceTargetValue = value;
        this.refreshFieldVisibility();
      },
      1,
      14
    );
    const recurrenceEndMode = new Setting(details).setName("Ends").setDesc("Keep repeating until you stop it, or choose a final date.").addDropdown((dropdown) => dropdown
      .addOption("manual", "Until I stop it")
      .addOption("date", "On a date")
      .setValue(this.recurrenceEndModeValue)
      .onChange((value) => {
        this.recurrenceEndModeValue = value as "manual" | "date";
        this.refreshFieldVisibility();
      }));
    this.recurrenceEndModeSettingEl = recurrenceEndMode.settingEl;
    this.recurrenceEndSettingEl = this.addDateSetting(
      "End date",
      "The final day on which this work can repeat.",
      this.recurrenceEndValue,
      (value) => { this.recurrenceEndValue = value; },
      details
    );
    this.recurrenceSummaryEl = details.createDiv({ cls: "goal-tree-recurrence-summary" });
    const timeMode = new Setting(details).setName("Time").setDesc("Use anytime unless this work has a fixed time.").addDropdown((dropdown) => dropdown
      .addOption("anytime", "Anytime")
      .addOption("specific", "Specific time")
      .setValue(this.timeModeValue)
      .onChange((value) => {
        this.timeModeValue = value as "anytime" | "specific";
        this.refreshFieldVisibility();
      }));
    this.timeModeSettingEl = timeMode.settingEl;
    this.scheduledStartTimeSettingEl = this.addTimeSetting(
      details,
      "Start time",
      "The same time is used for every selected repeat day.",
      this.scheduledStartTimeValue,
      (value) => { this.scheduledStartTimeValue = value; }
    );
    this.scheduledEndTimeSettingEl = this.addTimeSetting(
      details,
      "End time",
      "Must be later than the start time.",
      this.scheduledEndTimeValue,
      (value) => { this.scheduledEndTimeValue = value; }
    );
    this.refreshFieldVisibility();

    const buttons = contentEl.createDiv({ cls: "goal-tree-modal-actions" });
    new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
    new ButtonComponent(buttons)
      .setButtonText(this.options.existing ? "Save changes" : "Create")
      .setCta()
      .onClick(() => void this.submit());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addDateSetting(
    name: string,
    description: string,
    value: string,
    onChange: (value: string) => void,
    container: HTMLElement = this.contentEl
  ): HTMLElement {
    const setting = new Setting(container).setName(name).setDesc(description).addText((text) => {
      text.inputEl.type = "date";
      text.setValue(value).onChange(onChange);
    });
    return setting.settingEl;
  }

  private addTimeSetting(
    container: HTMLElement,
    name: string,
    description: string,
    value: string,
    onChange: (value: string) => void
  ): HTMLElement {
    const setting = new Setting(container).setName(name).setDesc(description).addText((text) => {
      text.inputEl.type = "time";
      text.setValue(value).onChange(onChange);
    });
    return setting.settingEl;
  }

  private refreshFieldVisibility(): void {
    const type = (this.typeSelect?.getValue() ?? this.typeValue) as GoalType;
    const work = isWorkType(type);
    const repeats = work && this.repeatEnabledValue && this.recurrenceValue !== "none";
    this.detailsEl?.toggleAttribute("hidden", !work);
    this.repeatToggleSettingEl?.toggleAttribute("hidden", !work);
    this.startSettingEl?.toggleAttribute("hidden", !hasPlanningDates(type));
    this.scheduledSettingEl?.toggleAttribute("hidden", !work || repeats);
    this.dueSettingEl?.toggleAttribute("hidden", !hasPlanningDates(type));
    this.severitySettingEl?.toggleAttribute("hidden", type === "area");
    this.meetingSettingEl?.toggleAttribute("hidden", !work);
    this.timeModeSettingEl?.toggleAttribute("hidden", !work);
    const showSpecificTime = work && this.timeModeValue === "specific";
    this.scheduledStartTimeSettingEl?.toggleAttribute("hidden", !showSpecificTime);
    this.scheduledEndTimeSettingEl?.toggleAttribute("hidden", !showSpecificTime);
    this.recurrenceSettingEl?.toggleAttribute("hidden", !repeats);
    const selectedWeekdays = this.recurrenceValue === "specific-weekdays" || this.recurrenceValue === "weekly-target";
    this.recurrenceIntervalSettingEl?.toggleAttribute(
      "hidden",
      !repeats || (this.recurrenceValue !== "weekly" && this.recurrenceValue !== "monthly")
    );
    this.recurrenceWeekdaysSettingEl?.toggleAttribute("hidden", !repeats || !selectedWeekdays);
    this.recurrenceTargetSettingEl?.toggleAttribute("hidden", !repeats || this.recurrenceValue !== "weekly-target");
    this.recurrenceEndModeSettingEl?.toggleAttribute("hidden", !repeats);
    this.recurrenceEndSettingEl?.toggleAttribute("hidden", !repeats || this.recurrenceEndModeValue !== "date");
    this.recurrenceSummaryEl?.toggleAttribute("hidden", !repeats);
    if (repeats && this.recurrenceSummaryEl) this.recurrenceSummaryEl.setText(this.recurrenceSummary());
    if (repeats && this.detailsEl) this.detailsEl.open = true;
    this.detailsSummaryEl?.setText("Schedule and recurrence");
  }

  private addNumberSetting(
    container: HTMLElement,
    name: string,
    description: string,
    value: string,
    onChange: (value: string) => void,
    min: number,
    max?: number
  ): HTMLElement {
    const setting = new Setting(container).setName(name).setDesc(description).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = String(min);
      if (max !== undefined) text.inputEl.max = String(max);
      text.setValue(value).onChange(onChange);
    });
    return setting.settingEl;
  }

  private addWeekdaySetting(container: HTMLElement): HTMLElement {
    const setting = new Setting(container)
      .setName("Preferred days")
      .setDesc("Your Planning workdays are selected by default. Any selected occurrence counts.");
    setting.settingEl.addClass("goal-tree-weekday-setting");
    const days = [
      { value: 0, label: "Sun" },
      { value: 1, label: "Mon" },
      { value: 2, label: "Tue" },
      { value: 3, label: "Wed" },
      { value: 4, label: "Thu" },
      { value: 5, label: "Fri" },
      { value: 6, label: "Sat" }
    ];
    const choices = setting.controlEl.createDiv({ cls: "goal-tree-weekday-choices" });
    for (const day of days) {
      const choice = choices.createEl("label", { cls: "goal-tree-weekday-choice" });
      const checkbox = choice.createEl("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.recurrenceWeekdaysValue.includes(day.value);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.recurrenceWeekdaysValue = [...new Set([...this.recurrenceWeekdaysValue, day.value])].sort();
        else this.recurrenceWeekdaysValue = this.recurrenceWeekdaysValue.filter((value) => value !== day.value);
      });
      choice.createSpan({ text: day.label });
    }
    return setting.settingEl;
  }

  private async submit(): Promise<void> {
    const title = this.titleValue.trim();
    if (!title) {
      new Notice("Enter a title for the item.");
      return;
    }
    const type = (this.typeSelect?.getValue() ?? this.typeValue) as GoalType;
    const recurrence = isWorkType(type) && this.repeatEnabledValue ? this.recurrenceValue : "none";
    const repeats = recurrence !== "none";
    const generatedRecurrence = isGeneratedRecurrence(recurrence);
    const start = hasPlanningDates(type) ? this.startValue || undefined : undefined;
    const scheduled = isWorkType(type) && !repeats ? this.scheduledValue || undefined : undefined;
    const scheduledStartTime = isWorkType(type) && this.timeModeValue === "specific"
      ? this.scheduledStartTimeValue || undefined
      : undefined;
    const scheduledEndTime = isWorkType(type) && this.timeModeValue === "specific"
      ? this.scheduledEndTimeValue || undefined
      : undefined;
    const due = hasPlanningDates(type) ? this.dueValue || undefined : undefined;
    if (hasPlanningDates(type) && !start) {
      new Notice(`Choose a start date for this ${label(type)}.`);
      return;
    }
    if (start && due && start > due) {
      new Notice("Start date must be on or before the due date.");
      return;
    }
    if (scheduled && start && scheduled < start) {
      new Notice("Planned day cannot be before the start date.");
      return;
    }
    if (scheduled && due && scheduled > due) {
      new Notice("Planned day cannot be after the due date.");
      return;
    }
    if (scheduledStartTime || scheduledEndTime) {
      if (!scheduled && !repeats) {
        new Notice("Choose a planned day before adding a specific time.");
        return;
      }
      if (!scheduledStartTime || !scheduledEndTime) {
        new Notice("Enter both the start and end time.");
        return;
      }
      if (scheduledStartTime >= scheduledEndTime) {
        new Notice("End time must be after start time.");
        return;
      }
    }
    const plannedMinutes = scheduledStartTime && scheduledEndTime
      ? minutesBetweenTimes(scheduledStartTime, scheduledEndTime)
      : this.options.existing?.plannedMinutes;
    const selectedWeekdays = recurrence === "specific-weekdays" || recurrence === "weekly-target";
    const storesWeekdays = selectedWeekdays || recurrence === "weekdays";
    if (storesWeekdays && this.recurrenceWeekdaysValue.length === 0) {
      new Notice("Select at least one weekday for this recurrence.");
      return;
    }
    const recurrenceStart = generatedRecurrence
      ? this.options.existing?.recurrenceStart ?? start ?? scheduled ?? todayIso()
      : undefined;
    const recurrenceEnd = repeats && this.recurrenceEndModeValue === "date"
      ? this.recurrenceEndValue || undefined
      : undefined;
    if (repeats && this.recurrenceEndModeValue === "date" && !recurrenceEnd) {
      new Notice("Choose an end date or select Until I stop it.");
      return;
    }
    const repeatStart = recurrenceStart ?? start;
    if (repeatStart && recurrenceEnd && recurrenceEnd < repeatStart) {
      new Notice("Repeat until must be on or after the start date.");
      return;
    }
    const parentId = this.parentSelect?.getValue() || undefined;
    if (type !== "area") {
      const parent = parentId ? this.options.nodes.find((node) => node.id === parentId) : undefined;
      if (!parent || !canParentType(parent.type, type)) {
        new Notice(`Select a valid parent for this ${label(type)}.`);
        return;
      }
    }
    try {
      await this.options.onSubmit({
        title,
        notes: this.notesValue.trim() || undefined,
        type,
        parentId: type === "area" ? undefined : parentId,
        start,
        scheduled,
        scheduledStartTime,
        scheduledEndTime,
        plannedMinutes,
        isMeeting: isWorkType(type) ? this.isMeetingValue : undefined,
        due,
        severity: this.severityValue,
        recurrence,
        recurrenceInterval: Math.max(1, Math.round(optionalNumber(this.recurrenceIntervalValue) ?? 1)),
        recurrenceWeekdays: storesWeekdays ? [...this.recurrenceWeekdaysValue] : undefined,
        recurrenceTarget: recurrence === "weekly-target"
          ? Math.max(1, Math.round(optionalNumber(this.recurrenceTargetValue) ?? 1))
          : undefined,
        recurrenceStart,
        recurrenceEnd,
        seriesId: this.options.existing?.seriesId
      });
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Could not save the item: ${message}`);
    }
  }

  private refreshParentOptions(): void {
    if (!this.parentSelect) return;
    const type = (this.typeSelect?.getValue() ?? this.typeValue) as GoalType;
    this.typeValue = type;
    this.parentSelect.selectEl.empty();
    if (type === "area") {
      this.parentSelect.selectEl.disabled = false;
      this.parentSelect.addOption("", "No parent (root)").setValue("");
      this.parentValue = undefined;
      return;
    }
    const excluded = this.options.existing ? descendantIds(this.options.existing) : new Set<string>();
    if (this.options.existing) excluded.add(this.options.existing.stableId);
    const valid = orderedNodes(this.options.nodes).filter((entry) => {
      const node = this.options.nodes.find((candidate) => candidate.id === entry.id);
      return Boolean(node && !excluded.has(node.stableId) && canParentType(node.type, type));
    });
    if (valid.length === 0) {
      this.parentSelect.addOption("", `No valid ${parentLabelFor(type)} available`).setValue("");
      this.parentSelect.selectEl.disabled = true;
      this.parentValue = undefined;
      return;
    }
    this.parentSelect.selectEl.disabled = false;
    for (const entry of valid) {
      const node = this.options.nodes.find((candidate) => candidate.id === entry.id);
      this.parentSelect.addOption(entry.id, node ? parentPathTitle(node, this.options.nodes) : entry.title);
    }
    const currentIsValid = Boolean(this.parentValue && valid.some((entry) => entry.id === this.parentValue));
    this.parentValue = currentIsValid ? this.parentValue : valid[0].id;
    this.parentSelect.setValue(this.parentValue ?? "");
  }

  private updateModalTitle(): void {
    const type = (this.typeSelect?.getValue() ?? this.typeValue) as GoalType;
    this.setTitle(`${this.options.existing ? "Edit" : "Add"} ${type === "area" ? "Life Area" : label(type)}`);
  }

  private recurrenceSummary(): string {
    if (this.recurrenceValue !== "weekly-target") {
      return "Each occurrence can be completed separately while the repeating task stays active.";
    }
    const target = Math.max(1, Math.round(optionalNumber(this.recurrenceTargetValue) ?? 1));
    const weekStart = localDateIso(startOfLocalWeek(new Date(), 0));
    const weekEnd = localDateIso(addLocalDays(parseLocalIso(weekStart), 6));
    const seriesId = this.options.existing?.seriesId;
    const completed = seriesId
      ? this.options.nodes.filter((node) =>
          node.seriesId === seriesId &&
          node.metrics.status === "completed" &&
          Boolean(node.scheduled && node.scheduled >= weekStart && node.scheduled <= weekEnd)
        ).length
      : 0;
    return `This week: ${completed} of ${target} completed. The task remains active after each occurrence.`;
  }
}

class ListNameModal extends Modal {
  private titleValue = "";

  constructor(app: App, private readonly onSubmit: (title: string) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass("goal-tree-modal");
    this.modalEl.addClass("goal-tree-modal-shell");
    this.setTitle("New list");
    new Setting(this.contentEl).setName("Name").setDesc("Example: Movies or Technical Books").addText((text) => {
      text.setPlaceholder("List name").onChange((value) => { this.titleValue = value; });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    const actions = this.contentEl.createDiv({ cls: "goal-tree-modal-actions" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    new ButtonComponent(actions).setButtonText("Create").setCta().onClick(() => void this.submit());
  }

  onClose(): void { this.contentEl.empty(); }

  private async submit(): Promise<void> {
    try {
      await this.onSubmit(this.titleValue);
      this.close();
    } catch (error) {
      new Notice(`Could not create list: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

class ListItemModal extends Modal {
  private titleValue: string;
  private urlValue: string;
  private notesValue: string;

  constructor(
    app: App,
    item: GoalListItem | undefined,
    private readonly onSubmit: (title: string, url?: string, notes?: string) => Promise<void>
  ) {
    super(app);
    this.titleValue = item?.title ?? "";
    this.urlValue = item?.url ?? "";
    this.notesValue = item?.notes ?? "";
  }

  onOpen(): void {
    this.contentEl.addClass("goal-tree-modal");
    this.modalEl.addClass("goal-tree-modal-shell");
    this.setTitle(this.titleValue ? "Edit list item" : "Add list item");
    new Setting(this.contentEl).setName("Title").addText((text) => {
      text.setPlaceholder("Item title").setValue(this.titleValue).onChange((value) => { this.titleValue = value; });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).setName("Link").setDesc("Optional website or reference link.").addText((text) =>
      text.setPlaceholder("https://...").setValue(this.urlValue).onChange((value) => { this.urlValue = value; })
    );
    new Setting(this.contentEl).setName("Notes").setDesc("Optional short note.").addTextArea((text) =>
      text.setPlaceholder("Why this item matters...").setValue(this.notesValue).onChange((value) => { this.notesValue = value; })
    );
    const actions = this.contentEl.createDiv({ cls: "goal-tree-modal-actions" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    new ButtonComponent(actions).setButtonText("Save").setCta().onClick(() => void this.submit());
  }

  onClose(): void { this.contentEl.empty(); }

  private async submit(): Promise<void> {
    try {
      await this.onSubmit(this.titleValue, this.urlValue || undefined, this.notesValue || undefined);
      this.close();
    } catch (error) {
      new Notice(`Could not save list item: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

class DeleteGoalModal extends Modal {
  private deleteSeries = false;

  constructor(
    app: App,
    private readonly node: GoalNode,
    private readonly forest: GoalForest,
    private readonly host: GoalTreeHost
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass("goal-tree-modal");
    this.modalEl.addClass("goal-tree-modal-shell");
    this.setTitle("Delete item");
    const childCount = descendantIds(this.node).size;
    this.contentEl.createEl("p", {
      text: childCount > 0
        ? `“${this.node.title}” and ${childCount} child item${childCount === 1 ? "" : "s"} will move to Obsidian trash.`
        : `“${this.node.title}” will move to Obsidian trash.`,
      cls: "goal-tree-modal-intro"
    });
    const seriesCount = this.node.seriesId
      ? this.forest.all.filter((candidate) => candidate.seriesId === this.node.seriesId).length
      : 0;
    if (seriesCount > 1) {
      new Setting(this.contentEl)
        .setName("Delete recurring series")
        .setDesc(`Also delete the other ${seriesCount - 1} occurrence${seriesCount === 2 ? "" : "s"}.`)
        .addToggle((toggle) => toggle.setValue(false).onChange((value) => { this.deleteSeries = value; }));
    }
    const buttons = this.contentEl.createDiv({ cls: "goal-tree-modal-actions" });
    new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
    new ButtonComponent(buttons).setButtonText("Move to trash").setWarning().onClick(() => void this.confirm());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async confirm(): Promise<void> {
    try {
      await this.host.deleteGoal(this.node, this.deleteSeries);
      this.close();
    } catch (error) {
      new Notice(`Could not delete the item: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

function orderedNodes(nodes: GoalNode[]): Array<{ id: string; title: string; depth: number }> {
  const result: Array<{ id: string; title: string; depth: number }> = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter((node) => !node.parentId || !byId.has(node.parentId));
  const visited = new Set<string>();
  const visit = (node: GoalNode, depth: number): void => {
    if (visited.has(node.stableId)) return;
    visited.add(node.stableId);
    result.push({ id: node.id, title: node.title, depth });
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const node of nodes) visit(node, 0);
  return result;
}

function descendantIds(node: GoalNode): Set<string> {
  const result = new Set<string>();
  const visit = (current: GoalNode): void => {
    for (const child of current.children) {
      result.add(child.stableId);
      visit(child);
    }
  };
  visit(node);
  return result;
}

function ancestorTitles(node: GoalNode, forest: GoalForest): string {
  const byId = new Map(forest.all.map((item) => [item.id, item]));
  const titles: string[] = [];
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    titles.unshift(parent.title);
    parentId = parent.parentId;
  }
  return titles.join(" › ");
}

function parentPathTitle(node: GoalNode, nodes: GoalNode[]): string {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const titles = [node.title];
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    titles.unshift(parent.title);
    parentId = parent.parentId;
  }
  return titles.join(" › ");
}

function fullPathTitle(node: GoalNode, forest: GoalForest): string {
  const ancestors = ancestorTitles(node, forest);
  const title = itemDisplayTitle(node);
  return ancestors ? `${ancestors} › ${title}` : title;
}

function itemDisplayTitle(node: GoalNode): string {
  if (node.recurrence === "weekly-target" && node.recurrenceOrdinal && node.recurrenceTarget) {
    return `${node.title} (${node.recurrenceOrdinal}/${node.recurrenceTarget})`;
  }
  return node.title;
}

function branchContainsLeaf(node: GoalNode, leafIds: Set<string>): boolean {
  if (leafIds.has(node.stableId)) return true;
  return node.children.some((child) => branchContainsLeaf(child, leafIds));
}

function actionableWorkDescendants(node: GoalNode): GoalNode[] {
  const result: GoalNode[] = [];
  const visit = (current: GoalNode): void => {
    for (const child of current.children) {
      if (!isWorkItem(child)) continue;
      if (isActionableWorkItem(child)) result.push(child);
      else visit(child);
    }
  };
  visit(node);
  return result;
}

function iconForType(type: GoalType): string {
  if (type === "area") return "layout-dashboard";
  if (type === "goal") return "target";
  if (type === "project") return "folder-kanban";
  if (type === "task") return "list-checks";
  return "list-tree";
}

function childTypeFor(type: GoalType): GoalType {
  if (type === "area") return "goal";
  if (type === "goal") return "project";
  if (type === "project") return "task";
  return "subtask";
}

function parentLabelFor(type: GoalType): string {
  if (type === "goal") return "life area or goal";
  if (type === "project") return "goal";
  if (type === "task") return "project";
  if (type === "subtask") return "task or subtask";
  return "parent";
}

function isWorkType(type: GoalType): boolean {
  return type === "task" || type === "subtask";
}

function hasPlanningDates(type: GoalType): boolean {
  return type !== "area";
}

function isGeneratedRecurrence(rule: RecurrenceRule): boolean {
  return rule === "daily" || rule === "weekdays" || rule === "specific-weekdays" || rule === "weekly-target";
}

function kanbanHierarchyRoot(node: GoalNode, nodes: GoalNode[]): GoalNode {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const visited = new Set<string>([node.stableId]);
  const workRoot = workHierarchyRoot(node, nodes);
  let parent = workRoot.parentId ? byId.get(workRoot.parentId) : undefined;
  while (parent && !visited.has(parent.stableId)) {
    visited.add(parent.stableId);
    if (parent.type === "project") return parent;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return workRoot;
}

function weeklyTargetCompleted(node: GoalNode, forest: GoalForest): number {
  if (!node.seriesId || !node.recurrenceKey) return node.metrics.status === "completed" ? 1 : 0;
  const match = node.recurrenceKey.match(/:week:(\d{4}-\d{2}-\d{2}):\d+$/);
  if (!match) return node.metrics.status === "completed" ? 1 : 0;
  const prefix = `${node.seriesId}:week:${match[1]}:`;
  return forest.all.filter(
    (candidate) => candidate.recurrenceKey?.startsWith(prefix) && candidate.metrics.status === "completed"
  ).length;
}

function statusIcon(status: CalculatedStatus): string {
  if (status === "completed") return "check";
  if (status === "in-progress") return "minus";
  if (status === "cancelled") return "x";
  return "circle";
}

function nextStatus(status: CalculatedStatus): ManualStatus {
  if (status === "not-started") return "in-progress";
  if (status === "in-progress") return "completed";
  return "not-started";
}

function nextStatusLabel(status: CalculatedStatus): string {
  if (status === "not-started") return "Start";
  if (status === "in-progress") return "Complete";
  return "Reopen";
}

function label(value: string): string {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function recurrenceLabel(rule: RecurrenceRule): string {
  if (rule === "daily") return "every day";
  if (rule === "weekdays") return "workdays";
  if (rule === "specific-weekdays") return "selected weekdays";
  if (rule === "weekly-target") return "times per week";
  if (rule === "weekly") return "every week";
  if (rule === "monthly") return "every month";
  return "does not repeat";
}

function recurrenceDescription(node: GoalNode): string {
  if (node.recurrence === "weekly-target") return `${node.recurrenceTarget ?? 1} times each week`;
  if (node.recurrence === "specific-weekdays") {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return (node.recurrenceWeekdays ?? []).map((day) => names[day]).join(", ") || "Selected weekdays";
  }
  const base = recurrenceLabel(node.recurrence);
  if ((node.recurrence === "weekly" || node.recurrence === "monthly") && node.recurrenceInterval > 1) {
    return `Every ${node.recurrenceInterval} ${node.recurrence === "weekly" ? "weeks" : "months"}`;
  }
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function inspectorScheduleText(node: GoalNode, timeFormat: GoalTreeSettings["timeFormat"]): string {
  if (!node.scheduled) return "Anytime / not scheduled";
  const time = scheduledTimeText(node, timeFormat);
  return `${formatDateLabel(node.scheduled)}${time ? ` · ${time}` : " · Anytime"}`;
}

function healthReason(node: GoalNode): string {
  if (node.metrics.health === "overdue") return node.due ? `Overdue since ${formatDateLabel(node.due)}.` : "This branch contains overdue work.";
  if (node.metrics.health === "at-risk") return node.due
    ? `Due ${formatDateLabel(node.due)} with unfinished work in this branch.`
    : "This branch contains work that needs attention.";
  if (node.metrics.health === "completed-late") return "Completed after its due date.";
  if (node.metrics.health === "completed-on-time") return "Completed on time.";
  if (node.metrics.health === "cancelled") return "This item is cancelled.";
  return node.due ? `On track for ${formatDateLabel(node.due)}.` : "On track. No deadline risk detected.";
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}


function formatClockTime(value: string, timeFormat: GoalTreeSettings["timeFormat"] = "12-hour"): string {
  const [hourValue, minuteValue] = value.split(":").map(Number);
  if (!Number.isFinite(hourValue) || !Number.isFinite(minuteValue)) return value;
  if (timeFormat === "24-hour") return `${String(hourValue).padStart(2, "0")}:${String(minuteValue).padStart(2, "0")}`;
  const suffix = hourValue >= 12 ? "PM" : "AM";
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minuteValue).padStart(2, "0")} ${suffix}`;
}

function scheduledTimeText(node: GoalNode, timeFormat: GoalTreeSettings["timeFormat"] = "12-hour"): string {
  if (node.scheduledStartTime && node.scheduledEndTime) {
    return `${formatClockTime(node.scheduledStartTime, timeFormat)}–${formatClockTime(node.scheduledEndTime, timeFormat)}`;
  }
  return node.scheduledStartTime ? formatClockTime(node.scheduledStartTime, timeFormat) : "";
}

function minutesBetweenTimes(start: string, end: string): number {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
}

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

function weekStartIndex(value: GoalTreeSettings["weekStartsOn"]): number {
  if (value === "monday") return 1;
  if (value === "saturday") return 6;
  return 0;
}

function rotate<T>(values: T[], start: number): T[] {
  return [...values.slice(start), ...values.slice(0, start)];
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfLocalWeek(date: Date, weekStartsOn: number): Date {
  const offset = (date.getDay() - weekStartsOn + 7) % 7;
  return addLocalDays(date, -offset);
}

function kanbanScopeLabel(scope: KanbanScope): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

function kanbanScopeUnit(scope: KanbanScope): string {
  if (scope === "daily") return "day";
  if (scope === "weekly") return "week";
  if (scope === "monthly") return "month";
  if (scope === "quarterly") return "quarter";
  return "year";
}

function shiftKanbanDate(date: Date, scope: KanbanScope, direction: -1 | 1): Date {
  if (scope === "daily") return addLocalDays(date, direction);
  if (scope === "weekly") return addLocalDays(date, direction * 7);
  if (scope === "monthly") return new Date(date.getFullYear(), date.getMonth() + direction, 1);
  if (scope === "quarterly") return new Date(date.getFullYear(), date.getMonth() + direction * 3, 1);
  return new Date(date.getFullYear() + direction, date.getMonth(), 1);
}

function kanbanRange(scope: KanbanScope, date: Date, weekStartsOn: number): KanbanDateRange {
  if (scope === "daily") {
    const iso = localDateIso(date);
    return {
      start: iso,
      end: iso,
      label: date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
    };
  }
  let startDate: Date;
  let endDate: Date;
  let rangeLabel: string | undefined;
  if (scope === "weekly") {
    startDate = startOfLocalWeek(date, weekStartsOn);
    endDate = addLocalDays(startDate, 6);
  } else if (scope === "monthly") {
    startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    rangeLabel = startDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } else if (scope === "quarterly") {
    const quarter = Math.floor(date.getMonth() / 3);
    startDate = new Date(date.getFullYear(), quarter * 3, 1);
    endDate = new Date(date.getFullYear(), quarter * 3 + 3, 0);
    rangeLabel = `Q${quarter + 1} ${date.getFullYear()}`;
  } else {
    startDate = new Date(date.getFullYear(), 0, 1);
    endDate = new Date(date.getFullYear(), 11, 31);
    rangeLabel = String(date.getFullYear());
  }
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  return {
    start: localDateIso(startDate),
    end: localDateIso(endDate),
    label: rangeLabel ?? `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" })} – ${endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
  };
}

function dateRangeFor(
  scope: ReviewRange,
  today: string,
  weekStartsOn: number,
  customStart?: string,
  customEnd?: string
): DateRange {
  if (scope === "all") return {};
  if (scope === "custom") {
    if (customStart && customEnd && customStart > customEnd) return { start: customEnd, end: customStart };
    return { start: customStart, end: customEnd };
  }
  const date = parseLocalIso(today);
  if (scope === "today") return { start: today, end: today };
  if (scope === "week") {
    const start = startOfLocalWeek(date, weekStartsOn);
    return { start: localDateIso(start), end: localDateIso(addLocalDays(start, 6)) };
  }
  if (scope === "month") {
    return {
      start: localDateIso(new Date(date.getFullYear(), date.getMonth(), 1)),
      end: localDateIso(new Date(date.getFullYear(), date.getMonth() + 1, 0))
    };
  }
  if (scope === "quarter") {
    const quarter = Math.floor(date.getMonth() / 3);
    return {
      start: localDateIso(new Date(date.getFullYear(), quarter * 3, 1)),
      end: localDateIso(new Date(date.getFullYear(), quarter * 3 + 3, 0))
    };
  }
  return {
    start: `${date.getFullYear()}-01-01`,
    end: `${date.getFullYear()}-12-31`
  };
}

function completionDateTime(node: GoalNode): string {
  return node.completedAt ?? node.metrics.effectiveCompletedAt ?? "";
}

function formatCompletedDate(node: GoalNode): string {
  const value = completionDateTime(node);
  if (!value) return "date unavailable";
  return parseLocalIso(value.slice(0, 10)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function kanbanPlanningText(node: GoalNode, showDueDate: boolean): string {
  if (node.scheduled) return `Planned ${node.scheduled}`;
  if (node.start && node.due) {
    if (!showDueDate) return `Starts ${node.start}`;
    return node.start === node.due ? node.start : `${node.start} → ${node.due}`;
  }
  if (node.start) return `Starts ${node.start}`;
  if (node.due && showDueDate) return `Due ${node.due}`;
  return "";
}

function compareKanbanItems(a: GoalNode, b: GoalNode): number {
  const aKey = `${a.scheduled ?? a.start ?? a.due ?? "9999-12-31"}T${a.scheduledStartTime ?? "99:99"}`;
  const bKey = `${b.scheduled ?? b.start ?? b.due ?? "9999-12-31"}T${b.scheduledStartTime ?? "99:99"}`;
  return aKey.localeCompare(bKey) || a.title.localeCompare(b.title);
}

function compareAttention(a: GoalNode, b: GoalNode): number {
  const healthOrder = (node: GoalNode): number => node.metrics.health === "overdue" ? 0 : 1;
  return healthOrder(a) - healthOrder(b) ||
    (a.due ?? "9999-12-31").localeCompare(b.due ?? "9999-12-31") ||
    a.title.localeCompare(b.title);
}

function overlapsDateRange(node: GoalNode, start: string, end: string): boolean {
  if (!node.start && !node.due) return false;
  const itemStart = node.start ?? node.due ?? start;
  const itemEnd = node.due ?? node.start ?? end;
  return itemStart <= end && itemEnd >= start;
}

function isPlannedInRange(node: GoalNode, start: string, end: string): boolean {
  if (node.scheduled) return node.scheduled >= start && node.scheduled <= end;
  return overlapsDateRange(node, start, end);
}

function isExplicitlyPlannedOn(node: GoalNode, date: string): boolean {
  if (node.scheduled) return node.scheduled === date;
  return node.start === date || node.due === date;
}

function addCalendarEntry(
  map: Map<string, CalendarEntry[]>,
  date: string | undefined,
  node: GoalNode,
  kind: CalendarEntry["kind"]
): void {
  if (!date) return;
  const values = map.get(date) ?? [];
  values.push({ node, kind });
  map.set(date, values);
}

function parseLocalIso(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDateIso(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatDateLabel(value: string): string {
  return parseLocalIso(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface ForceGraphEntry {
  id: string;
  parentId: string;
  node: GoalNode;
}

interface ForceGraphNodeState {
  id: string;
  entry?: ForceGraphEntry;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  dragging: boolean;
  element: SVGGElement;
}

interface ForceGraphLinkState {
  source: ForceGraphNodeState;
  target: ForceGraphNodeState;
  line: SVGPathElement;
}

interface ForceGraphOptions {
  motion: boolean;
  labels: GoalTreeSettings["graphLabels"];
  spacing: GoalTreeSettings["graphSpacing"];
  selectedId?: string;
}

function graphNodeRadius(type: GoalType): number {
  if (type === "area") return 8;
  if (type === "goal") return 6.5;
  if (type === "project") return 5.25;
  if (type === "task") return 4.25;
  return 3.25;
}

function graphSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function mountForceGraph(
  svg: SVGSVGElement,
  entries: ForceGraphEntry[],
  openNode: (node: GoalNode) => void,
  options: ForceGraphOptions
): { zoomIn: () => void; zoomOut: () => void; reset: () => void; destroy: () => void } {
  const scene = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const guideLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  guideLayer.setAttribute("class", "goal-tree-graph-guides");
  const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  scene.append(guideLayer, edgeLayer, nodeLayer);
  svg.appendChild(scene);

  let width = Math.max(320, svg.parentElement?.clientWidth ?? 900);
  let height = Math.max(520, svg.clientHeight || 620);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const transform = { x: 0, y: 0, scale: 1 };
  const updateTransform = (): void => {
    scene.setAttribute("transform", `translate(${transform.x} ${transform.y}) scale(${transform.scale})`);
  };
  const depth: Record<GoalType, number> = { area: 0, goal: 1, project: 2, task: 3, subtask: 4 };
  const columnLabels = ["Area", "Goal", "Project", "Task", "Subtask"];
  const levelGap = options.spacing === "compact" ? 230 : 280;
  const rowGap = options.spacing === "compact" ? 48 : 60;
  const horizontalPadding = 76;
  const verticalPadding = 72;
  const childrenByParent = new Map<string, ForceGraphEntry[]>();
  for (const entry of entries) {
    const children = childrenByParent.get(entry.parentId) ?? [];
    children.push(entry);
    childrenByParent.set(entry.parentId, children);
  }
  let leafIndex = 0;
  const targetYById = new Map<string, number>();
  const assignY = (entry: ForceGraphEntry): number => {
    const children = childrenByParent.get(entry.id) ?? [];
    const y = children.length > 0
      ? children.map(assignY).reduce((total, value) => total + value, 0) / children.length
      : verticalPadding + leafIndex++ * rowGap;
    targetYById.set(entry.id, y);
    return y;
  };
  const roots = childrenByParent.get("root") ?? [];
  roots.forEach(assignY);
  const contentWidth = horizontalPadding * 2 + 4 * levelGap;
  const naturalContentHeight = verticalPadding * 2 + Math.max(0, leafIndex - 1) * rowGap;
  const contentHeight = Math.max(360, naturalContentHeight);
  const verticalOffset = (contentHeight - naturalContentHeight) / 2;
  for (const [id, y] of targetYById) targetYById.set(id, y + verticalOffset);
  const rootY = roots.length > 0
    ? roots.map((entry) => targetYById.get(entry.id) ?? verticalPadding).reduce((total, value) => total + value, 0) / roots.length
    : contentHeight / 2;
  for (let level = 0; level <= 4; level += 1) {
    const x = horizontalPadding + level * levelGap;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "goal-tree-graph-level");
    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    line.setAttribute("y1", "54");
    line.setAttribute("y2", String(contentHeight - 28));
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "goal-tree-graph-level-label");
    text.setAttribute("x", String(x));
    text.setAttribute("y", "26");
    text.textContent = columnLabels[level];
    const count = document.createElementNS("http://www.w3.org/2000/svg", "text");
    count.setAttribute("class", "goal-tree-graph-level-count");
    count.setAttribute("x", String(x));
    count.setAttribute("y", "42");
    count.textContent = `${entries.filter((entry) => depth[entry.node.type] === level).length} items`;
    guideLayer.append(line, text, count);
  }

  const rootElement = document.createElementNS("http://www.w3.org/2000/svg", "g");
  rootElement.setAttribute("class", "goal-tree-graph-root");
  const rootDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  rootDot.setAttribute("r", "4");
  rootElement.appendChild(rootDot);
  nodeLayer.appendChild(rootElement);
  const root: ForceGraphNodeState = {
    id: "root",
    x: 26,
    y: rootY,
    targetX: 26,
    targetY: rootY,
    vx: 0,
    vy: 0,
    dragging: false,
    element: rootElement
  };
  const states = [root];
  const byId = new Map<string, ForceGraphNodeState>([[root.id, root]]);
  const connectedIds = new Set<string>();
  if (options.selectedId) {
    connectedIds.add(options.selectedId);
    const selected = entries.find((entry) => entry.id === options.selectedId);
    if (selected) connectedIds.add(selected.parentId);
    for (const entry of entries) if (entry.parentId === options.selectedId) connectedIds.add(entry.id);
  }

  for (const entry of entries) {
    const seed = graphSeed(entry.id);
    const targetX = horizontalPadding + depth[entry.node.type] * levelGap;
    const targetY = targetYById.get(entry.id) ?? contentHeight / 2;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const selectionClass = entry.id === options.selectedId
      ? " is-selected"
      : options.selectedId && connectedIds.has(entry.id) ? " is-connected" : options.selectedId ? " is-dimmed" : "";
    group.setAttribute("class", `goal-tree-graph-node labels-${options.labels} type-${entry.node.type} status-${entry.node.metrics.status} health-${entry.node.metrics.health} severity-${entry.node.severity}${selectionClass}`);
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `${entry.node.title}, ${label(entry.node.type)}, ${label(entry.node.metrics.health)}`);
    const radius = graphNodeRadius(entry.node.type);
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.setAttribute("r", String(Math.max(14, radius + 9)));
    hit.setAttribute("class", "goal-tree-graph-hit");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", String(radius));
    dot.setAttribute("class", "goal-tree-graph-dot");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.setAttribute("x", String(radius + 7));
    title.setAttribute("y", "4");
    title.textContent = entry.node.title;
    group.append(hit, dot, title);
    nodeLayer.appendChild(group);
    const state: ForceGraphNodeState = {
      id: entry.id,
      entry,
      x: targetX - 32 + seed * 64,
      y: targetY - 22 + graphSeed(`${entry.id}-y`) * 44,
      targetX,
      targetY,
      vx: 0,
      vy: 0,
      dragging: false,
      element: group
    };
    states.push(state);
    byId.set(entry.id, state);
  }

  const links: ForceGraphLinkState[] = [];
  for (const entry of entries) {
    const source = byId.get(entry.parentId);
    const target = byId.get(entry.id);
    if (!source || !target) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("class", "goal-tree-graph-edge");
    if (options.selectedId && (entry.id === options.selectedId || entry.parentId === options.selectedId)) {
      line.classList.add("is-connected");
    } else if (options.selectedId) line.classList.add("is-dimmed");
    edgeLayer.appendChild(line);
    links.push({ source, target, line });
  }

  let alpha = 1;
  let frame = 0;
  const updateElements = (): void => {
    for (const state of states) state.element.setAttribute("transform", `translate(${state.x} ${state.y})`);
    for (const link of links) {
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const bend = Math.min(20, Math.hypot(dx, dy) * 0.08);
      const midpointX = (link.source.x + link.target.x) / 2 - dy / Math.max(1, Math.hypot(dx, dy)) * bend;
      const midpointY = (link.source.y + link.target.y) / 2 + dx / Math.max(1, Math.hypot(dx, dy)) * bend;
      link.line.setAttribute("d", `M ${link.source.x} ${link.source.y} Q ${midpointX} ${midpointY} ${link.target.x} ${link.target.y}`);
    }
  };
  const physicsStep = (): void => {
    root.x = root.targetX;
    root.y = root.targetY;
    root.vx = 0;
    root.vy = 0;
    for (let index = 0; index < states.length; index += 1) {
      const left = states[index];
      for (let otherIndex = index + 1; otherIndex < states.length; otherIndex += 1) {
        const right = states[otherIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        const distanceSquared = Math.max(36, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSquared);
        dx /= distance;
        dy /= distance;
        const force = 1_850 * alpha / distanceSquared;
        if (left !== root && !left.dragging) {
          left.vx -= dx * force;
          left.vy -= dy * force;
        }
        if (right !== root && !right.dragging) {
          right.vx += dx * force;
          right.vy += dy * force;
        }
      }
    }
    for (const link of links) {
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const desired = link.source === root ? horizontalPadding - root.targetX : levelGap;
      const force = (distance - desired) * 0.006 * alpha;
      const fx = dx / distance * force;
      const fy = dy / distance * force;
      if (link.source !== root && !link.source.dragging) {
        link.source.vx += fx;
        link.source.vy += fy;
      }
      if (!link.target.dragging) {
        link.target.vx -= fx;
        link.target.vy -= fy;
      }
    }
    for (const state of states) {
      if (state === root || state.dragging) continue;
      state.vx += (state.targetX - state.x) * 0.055 * alpha;
      state.vy += (state.targetY - state.y) * 0.055 * alpha;
      state.vx *= 0.82;
      state.vy *= 0.82;
      state.x = Math.max(30, Math.min(contentWidth - 30, state.x + state.vx));
      state.y = Math.max(46, Math.min(contentHeight - 24, state.y + state.vy));
    }
    alpha *= 0.986;
  };
  const animate = (): void => {
    if (!svg.isConnected) return;
    physicsStep();
    updateElements();
    if (alpha > 0.025 || states.some((state) => state.dragging)) frame = window.requestAnimationFrame(animate);
    else frame = 0;
  };
  const reheat = (value = 0.35): void => {
    alpha = Math.max(alpha, value);
    if (options.motion && !frame && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      frame = window.requestAnimationFrame(animate);
    } else if (!options.motion) {
      for (let index = 0; index < 24; index += 1) physicsStep();
      updateElements();
    }
  };
  const clientPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * width / Math.max(1, rect.width),
      y: (clientY - rect.top) * height / Math.max(1, rect.height)
    };
  };

  for (const state of states.slice(1)) {
    const group = state.element;
    let previousX = 0;
    let previousY = 0;
    let moved = false;
    group.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      state.dragging = true;
      moved = false;
      const point = clientPoint(event.clientX, event.clientY);
      previousX = point.x;
      previousY = point.y;
      group.setPointerCapture(event.pointerId);
      group.classList.add("is-dragging");
      reheat(0.45);
    });
    group.addEventListener("pointermove", (event) => {
      if (!state.dragging) return;
      const point = clientPoint(event.clientX, event.clientY);
      const dx = (point.x - previousX) / transform.scale;
      const dy = (point.y - previousY) / transform.scale;
      if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
      state.x += dx;
      state.y += dy;
      state.vx = 0;
      state.vy = 0;
      previousX = point.x;
      previousY = point.y;
      updateElements();
    });
    const release = (event: PointerEvent, openWhenTapped: boolean): void => {
      if (!state.dragging) return;
      state.dragging = false;
      group.classList.remove("is-dragging");
      if (group.hasPointerCapture(event.pointerId)) group.releasePointerCapture(event.pointerId);
      if (moved) {
        state.targetX = state.x;
        state.targetY = state.y;
      }
      if (openWhenTapped && !moved && state.entry) openNode(state.entry.node);
      reheat(0.18);
    };
    group.addEventListener("pointerup", (event) => release(event, true));
    group.addEventListener("pointercancel", (event) => release(event, false));
    group.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && state.entry) openNode(state.entry.node);
    });
  }

  const fittedTransform = (): { x: number; y: number; scale: number } => {
    const scale = Math.max(0.28, Math.min(1, (width - 36) / contentWidth, (height - 36) / contentHeight));
    return {
      x: Math.max(18, (width - contentWidth * scale) / 2),
      y: Math.max(18, (height - contentHeight * scale) / 2),
      scale
    };
  };
  Object.assign(transform, fittedTransform());
  updateTransform();

  let zoomFrame = 0;
  const zoomTarget = { ...transform };
  const cancelZoomAnimation = (): void => {
    if (zoomFrame) window.cancelAnimationFrame(zoomFrame);
    zoomFrame = 0;
    Object.assign(zoomTarget, transform);
  };
  const animateZoom = (): void => {
    const smoothing = 0.16;
    transform.x += (zoomTarget.x - transform.x) * smoothing;
    transform.y += (zoomTarget.y - transform.y) * smoothing;
    transform.scale += (zoomTarget.scale - transform.scale) * smoothing;
    updateTransform();
    const remaining = Math.abs(zoomTarget.x - transform.x) +
      Math.abs(zoomTarget.y - transform.y) +
      Math.abs(zoomTarget.scale - transform.scale) * 100;
    if (remaining > 0.08) zoomFrame = window.requestAnimationFrame(animateZoom);
    else {
      Object.assign(transform, zoomTarget);
      updateTransform();
      zoomFrame = 0;
    }
  };
  const smoothZoomAt = (nextScale: number, clientX?: number, clientY?: number): void => {
    const next = Math.max(0.28, Math.min(4.5, nextScale));
    const anchor = clientX === undefined || clientY === undefined
      ? { x: width / 2, y: height / 2 }
      : clientPoint(clientX, clientY);
    const ratio = next / zoomTarget.scale;
    zoomTarget.x = anchor.x - (anchor.x - zoomTarget.x) * ratio;
    zoomTarget.y = anchor.y - (anchor.y - zoomTarget.y) * ratio;
    zoomTarget.scale = next;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      Object.assign(transform, zoomTarget);
      updateTransform();
    } else if (!zoomFrame) {
      zoomFrame = window.requestAnimationFrame(animateZoom);
    }
  };

  const activePointers = new Map<number, { x: number; y: number }>();
  let panX = 0;
  let panY = 0;
  let pinchDistance = 0;
  let pinchStart = { x: 0, y: 0, scale: 1, worldX: 0, worldY: 0 };
  svg.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest(".goal-tree-graph-node")) return;
    cancelZoomAnimation();
    const point = clientPoint(event.clientX, event.clientY);
    activePointers.set(event.pointerId, point);
    panX = point.x;
    panY = point.y;
    if (activePointers.size === 2) {
      const [first, second] = [...activePointers.values()];
      pinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      pinchStart = {
        x: transform.x,
        y: transform.y,
        scale: transform.scale,
        worldX: (midpoint.x - transform.x) / transform.scale,
        worldY: (midpoint.y - transform.y) / transform.scale
      };
    }
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;
    const point = clientPoint(event.clientX, event.clientY);
    activePointers.set(event.pointerId, point);
    if (activePointers.size === 1) {
      transform.x += point.x - panX;
      transform.y += point.y - panY;
      panX = point.x;
      panY = point.y;
    } else if (activePointers.size === 2) {
      const [first, second] = [...activePointers.values()];
      const nextDistance = Math.hypot(first.x - second.x, first.y - second.y);
      if (pinchDistance > 0) {
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        transform.scale = Math.max(0.28, Math.min(4.5, pinchStart.scale * nextDistance / pinchDistance));
        transform.x = midpoint.x - pinchStart.worldX * transform.scale;
        transform.y = midpoint.y - pinchStart.worldY * transform.scale;
      }
    }
    Object.assign(zoomTarget, transform);
    updateTransform();
  });
  const releasePointer = (event: PointerEvent): void => {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 1) {
      const remaining = [...activePointers.values()][0];
      panX = remaining.x;
      panY = remaining.y;
    }
  };
  svg.addEventListener("pointerup", releasePointer);
  svg.addEventListener("pointercancel", releasePointer);
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = Math.max(-80, Math.min(80, event.deltaY));
    smoothZoomAt(zoomTarget.scale * Math.exp(-delta * 0.0022), event.clientX, event.clientY);
  }, { passive: false });

  const resizeObserver = new ResizeObserver(() => {
    width = Math.max(320, svg.parentElement?.clientWidth ?? width);
    height = Math.max(520, svg.clientHeight || height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const fitted = fittedTransform();
    Object.assign(transform, fitted);
    Object.assign(zoomTarget, fitted);
    updateTransform();
    reheat(0.28);
  });
  resizeObserver.observe(svg.parentElement ?? svg);

  if (!options.motion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (let index = 0; index < 100; index += 1) physicsStep();
    updateElements();
  } else {
    frame = window.requestAnimationFrame(animate);
  }

  return {
    zoomIn: () => smoothZoomAt(zoomTarget.scale * 1.2),
    zoomOut: () => smoothZoomAt(zoomTarget.scale / 1.2),
    reset: () => {
      Object.assign(zoomTarget, fittedTransform());
      if (!zoomFrame) zoomFrame = window.requestAnimationFrame(animateZoom);
      reheat(0.3);
    },
    destroy: () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (zoomFrame) window.cancelAnimationFrame(zoomFrame);
      resizeObserver.disconnect();
    }
  };
}

export function todayIso(date = new Date()): string {
  return localDateIso(date);
}
