import { App, normalizePath, TAbstractFile, TFile, TFolder } from "obsidian";
import {
  buildGoalForest,
  canParentType,
  childFolderForGoalPath,
  GoalForest,
  GoalInput,
  GoalNode,
  GoalSeverity,
  GoalType,
  KanbanScope,
  ManualStatus,
  normalizeRecurrence,
  normalizeSeverity,
  RecurrenceRule,
  severityFromLegacyWeight,
  WorkDisplayMode
} from "./engine";
import {
  daysBetween,
  nextRecurrenceDate,
  normalizeWeekdays,
  planRecurringOccurrences,
  shiftIsoDate
} from "./recurrence";

export interface GoalTreeSettings {
  goalsFolder: string;
  defaultSeverity: GoalSeverity;
  syncCalculatedProperties: boolean;
  todayIncludeAvailable: boolean;
  weekStartsOn: "sunday" | "monday" | "saturday";
  kanbanDefaultScope: KanbanScope;
  kanbanDefaultDisplay: WorkDisplayMode;
  kanbanShowCompleted: boolean;
  kanbanShowUnscheduled: boolean;
  kanbanShowParentPath: boolean;
  kanbanShowSeverity: boolean;
  kanbanShowTime: boolean;
  kanbanShowDueDate: boolean;
}

export interface GoalFields {
  title: string;
  type: GoalType;
  parentId?: string;
  start?: string;
  scheduled?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  plannedMinutes?: number;
  isMeeting?: boolean;
  due?: string;
  severity: GoalSeverity;
  recurrence: RecurrenceRule;
  recurrenceInterval: number;
  recurrenceWeekdays?: number[];
  recurrenceTarget?: number;
  recurrenceStart?: string;
  recurrenceEnd?: string;
  recurrenceKey?: string;
  recurrenceOrdinal?: number;
  seriesId?: string;
}

export type NewGoalInput = GoalFields;
export type EditGoalInput = GoalFields;

export interface OrganizeResult {
  moved: number;
  skipped: number;
}

export interface RepairResult {
  updated: number;
  unresolved: number;
}

interface SourceRecord {
  file: TFile;
  frontmatter: Record<string, unknown> | undefined;
  stableId: string;
}

export class GoalRepository {
  private readonly generatedIds = new Map<string, string>();
  private readonly generatedRecurrenceKeys = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly settings: () => GoalTreeSettings
  ) {}

  load(today: string): GoalForest {
    const folder = normalizedFolder(this.settings().goalsFolder);
    const sources: SourceRecord[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (folder && file.path !== folder && !file.path.startsWith(`${folder}/`)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      if (!isEnabled(frontmatter?.["goal-tree"])) continue;
      sources.push({
        file,
        frontmatter,
        stableId: this.stableIdForPath(file.path, frontmatter?.["goal-id"])
      });
    }

    const pathByStableId = new Map(sources.map((source) => [source.stableId, source.file.path]));
    const records = sources.map<GoalInput>((source) => {
      const frontmatter = source.frontmatter;
      const linkedParent = this.resolveParent(source.file, frontmatter?.["goal-parent"]);
      const stableParent = optionalText(frontmatter?.["goal-parent-id"]);
      const type = goalType(frontmatter?.["goal-type"]);
      return {
        id: source.file.path,
        stableId: source.stableId,
        title: textValue(frontmatter?.["goal-title"]) || source.file.basename,
        type,
        parentId: linkedParent ?? (stableParent ? pathByStableId.get(stableParent) : undefined),
        manualStatus: manualStatus(frontmatter?.["goal-status"]),
        severity: goalSeverity(frontmatter?.["goal-severity"], frontmatter?.["goal-weight"]),
        start: hasPlanningDates(type) ? isoDate(frontmatter?.["goal-start"]) : undefined,
        scheduled: isWorkType(type) ? isoDate(frontmatter?.["goal-scheduled"]) : undefined,
        scheduledStartTime: isWorkType(type) ? timeValue(frontmatter?.["goal-start-time"]) : undefined,
        scheduledEndTime: isWorkType(type) ? timeValue(frontmatter?.["goal-end-time"]) : undefined,
        plannedMinutes: isWorkType(type) ? optionalPositive(frontmatter?.["goal-planned-minutes"]) : undefined,
        isMeeting: isWorkType(type) && isEnabled(frontmatter?.["goal-meeting"]),
        due: hasPlanningDates(type) ? isoDate(frontmatter?.["goal-due"]) : undefined,
        completedAt: optionalText(frontmatter?.["goal-completed"]),
        createdAt: optionalText(frontmatter?.["goal-created"]),
        recurrence: normalizeRecurrence(frontmatter?.["goal-recurrence"]),
        recurrenceInterval: positiveInteger(frontmatter?.["goal-recurrence-interval"], 1),
        recurrenceWeekdays: weekdayNumbers(frontmatter?.["goal-recurrence-weekdays"]),
        recurrenceTarget: optionalPositiveInteger(frontmatter?.["goal-recurrence-target"]),
        recurrenceStart: isoDate(frontmatter?.["goal-recurrence-start"]),
        recurrenceEnd: isoDate(frontmatter?.["goal-recurrence-end"]),
        recurrenceKey: optionalText(frontmatter?.["goal-recurrence-key"]),
        recurrenceOrdinal: optionalPositiveInteger(frontmatter?.["goal-recurrence-ordinal"]),
        seriesId: optionalText(frontmatter?.["goal-series-id"]),
        archived: isEnabled(frontmatter?.["goal-archived"])
      };
    });

    for (const record of records) {
      if (record.recurrenceKey) this.generatedRecurrenceKeys.add(record.recurrenceKey);
    }
    repairObviousWorkChildTypes(records);
    return buildGoalForest(records, today);
  }

  async create(input: NewGoalInput): Promise<TFile> {
    const folder = this.folderForParent(input.parentId);
    await this.ensureFolder(folder);

    const safeTitle = sanitizeFileName(input.title);
    const path = await this.uniquePath(folder, safeTitle);
    const parent = input.parentId ? this.nodeByPath(input.parentId) : undefined;
    const stableId = randomId();
    const recurrence = isWorkType(input.type) ? normalizeRecurrence(input.recurrence) : "none";
    const seriesId = input.seriesId ?? (recurrence !== "none" ? stableId : undefined);
    const recurringStart = isGeneratedRecurrence(recurrence)
      ? input.recurrenceStart ?? input.start ?? input.scheduled ?? localDateIso()
      : input.recurrenceStart;
    const planned = seriesId && recurringStart && !input.recurrenceKey
      ? planRecurringOccurrences(
          seriesId,
          recurrence,
          recurringStart,
          recurringStart,
          input.recurrenceEnd,
          input.recurrenceWeekdays,
          input.recurrenceTarget,
          this.settings().weekStartsOn,
          1
        )[0]
      : undefined;
    const content = createGoalMarkdown({
      ...input,
      title: input.title.trim(),
      start: hasPlanningDates(input.type) ? planned?.start ?? input.start : undefined,
      scheduled: isWorkType(input.type) ? planned?.scheduled ?? input.scheduled : undefined,
      due: hasPlanningDates(input.type) ? recurrenceDue(recurrence, input.due, planned?.due) : undefined,
      severity: normalizeSeverity(input.severity),
      recurrence,
      recurrenceInterval: positiveInteger(input.recurrenceInterval, 1),
      recurrenceWeekdays: normalizeWeekdays(input.recurrenceWeekdays),
      recurrenceTarget: recurrence === "weekly-target"
        ? positiveInteger(input.recurrenceTarget, 1)
        : undefined,
      recurrenceStart: recurringStart,
      recurrenceKey: input.recurrenceKey ?? planned?.key,
      recurrenceOrdinal: input.recurrenceOrdinal ?? planned?.ordinal,
      stableId,
      seriesId,
      parentLink: input.parentId ? wikiLinkForPath(input.parentId) : undefined,
      parentStableId: parent?.stableId
    });

    const file = await this.app.vault.create(path, content);
    const occurrenceKey = input.recurrenceKey ?? planned?.key;
    if (occurrenceKey) this.generatedRecurrenceKeys.add(occurrenceKey);
    return file;
  }

  async update(node: GoalNode, input: EditGoalInput): Promise<void> {
    const file = this.fileForNode(node);
    if (!file) throw new Error("The item note could not be found.");
    const parent = input.parentId ? this.nodeByPath(input.parentId) : undefined;
    const recurrence = isWorkType(input.type) ? normalizeRecurrence(input.recurrence) : "none";
    const seriesId = input.seriesId ?? node.seriesId ?? node.stableId;
    const seriesStart = input.recurrenceStart ?? node.recurrenceStart ?? input.start ?? node.start ?? localDateIso();
    const recurrenceChanged = recurrence !== node.recurrence;
    const initialPlan = isGeneratedRecurrence(recurrence) && (recurrenceChanged || !node.recurrenceKey)
      ? planRecurringOccurrences(
          seriesId,
          recurrence,
          seriesStart,
          seriesStart,
          input.recurrenceEnd,
          input.recurrenceWeekdays,
          input.recurrenceTarget,
          this.settings().weekStartsOn,
          1
        )[0]
      : undefined;
    const seriesMembers = node.seriesId
      ? this.load(localDateIso()).all.filter(
          (candidate) => candidate.seriesId === node.seriesId &&
            candidate.id !== node.id &&
            (recurrence === "none" || candidate.metrics.status !== "completed")
        )
      : [];

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter["goal-title"] = input.title.trim();
      frontmatter["goal-type"] = input.type;
      if (input.type === "area") delete frontmatter["goal-severity"];
      else frontmatter["goal-severity"] = normalizeSeverity(input.severity);
      deleteLegacyProgressProperties(frontmatter);
      setOptional(frontmatter, "goal-parent", input.parentId ? wikiLinkForPath(input.parentId) : undefined);
      setOptional(frontmatter, "goal-parent-id", parent?.stableId);
      setOptional(frontmatter, "goal-start", hasPlanningDates(input.type) ? initialPlan?.start ?? input.start : undefined);
      setOptional(
        frontmatter,
        "goal-scheduled",
        isWorkType(input.type)
          ? initialPlan?.scheduled ?? (isGeneratedRecurrence(recurrence) && node.recurrenceKey ? node.scheduled : input.scheduled)
          : undefined
      );
      setOptional(frontmatter, "goal-start-time", isWorkType(input.type) ? input.scheduledStartTime : undefined);
      setOptional(frontmatter, "goal-end-time", isWorkType(input.type) ? input.scheduledEndTime : undefined);
      setOptionalNumber(frontmatter, "goal-planned-minutes", isWorkType(input.type) ? input.plannedMinutes : undefined);
      setOptionalBoolean(frontmatter, "goal-meeting", isWorkType(input.type) && input.isMeeting ? true : undefined);
      setOptional(
        frontmatter,
        "goal-due",
        hasPlanningDates(input.type) ? recurrenceDue(recurrence, input.due, initialPlan?.due) : undefined
      );
      if (input.type === "area") {
        frontmatter["goal-status"] = "ongoing";
        delete frontmatter["goal-progress"];
        delete frontmatter["goal-completed"];
        delete frontmatter["goal-target-value"];
        delete frontmatter["goal-current-value"];
        delete frontmatter["goal-metric-unit"];
        delete frontmatter["goal-time-target-minutes"];
        delete frontmatter["goal-recurrence"];
        delete frontmatter["goal-recurrence-interval"];
        delete frontmatter["goal-recurrence-weekdays"];
        delete frontmatter["goal-recurrence-target"];
        delete frontmatter["goal-recurrence-start"];
        delete frontmatter["goal-recurrence-end"];
        delete frontmatter["goal-recurrence-key"];
        delete frontmatter["goal-recurrence-ordinal"];
        delete frontmatter["goal-series-id"];
      } else if (textValue(frontmatter["goal-status"]) === "ongoing") {
        frontmatter["goal-status"] = "not-started";
      }
      if (input.type !== "area") {
        frontmatter["goal-progress"] = textValue(frontmatter["goal-status"]) === "completed" ? 100 : 0;
      }
      delete frontmatter["goal-weekly-focus-target-minutes"];
      if (recurrence === "none") {
        delete frontmatter["goal-recurrence"];
        delete frontmatter["goal-recurrence-interval"];
        delete frontmatter["goal-recurrence-weekdays"];
        delete frontmatter["goal-recurrence-target"];
        delete frontmatter["goal-recurrence-start"];
        delete frontmatter["goal-recurrence-end"];
        delete frontmatter["goal-recurrence-key"];
        delete frontmatter["goal-recurrence-ordinal"];
        delete frontmatter["goal-series-id"];
      } else {
        frontmatter["goal-recurrence"] = recurrence;
        frontmatter["goal-recurrence-interval"] = positiveInteger(input.recurrenceInterval, 1);
        setOptionalNumberList(frontmatter, "goal-recurrence-weekdays", normalizeWeekdays(input.recurrenceWeekdays));
        setOptionalNumber(frontmatter, "goal-recurrence-target", recurrence === "weekly-target"
          ? positiveInteger(input.recurrenceTarget, 1)
          : undefined);
        setOptional(frontmatter, "goal-recurrence-start", isGeneratedRecurrence(recurrence)
          ? seriesStart
          : undefined);
        setOptional(frontmatter, "goal-recurrence-end", input.recurrenceEnd);
        setOptional(frontmatter, "goal-recurrence-key", isGeneratedRecurrence(recurrence)
          ? initialPlan?.key ?? node.recurrenceKey
          : undefined);
        setOptionalNumber(frontmatter, "goal-recurrence-ordinal", isGeneratedRecurrence(recurrence)
          ? initialPlan?.ordinal ?? node.recurrenceOrdinal
          : undefined);
        frontmatter["goal-series-id"] = seriesId;
      }
      delete frontmatter["goal-weight"];
    });
    if (recurrenceChanged && node.seriesId) {
      for (const key of [...this.generatedRecurrenceKeys]) {
        if (key.startsWith(`${node.seriesId}:`)) this.generatedRecurrenceKeys.delete(key);
      }
    }
    if (initialPlan?.key) this.generatedRecurrenceKeys.add(initialPlan.key);

    if (node.seriesId && seriesMembers.length > 0) {
      for (const member of seriesMembers) {
        const memberFile = this.fileForNode(member);
        if (!memberFile) continue;
        await this.app.fileManager.processFrontMatter(memberFile, (frontmatter) => {
          frontmatter["goal-title"] = input.title.trim();
          frontmatter["goal-type"] = input.type;
          frontmatter["goal-severity"] = normalizeSeverity(input.severity);
          deleteLegacyProgressProperties(frontmatter);
          frontmatter["goal-progress"] = textValue(frontmatter["goal-status"]) === "completed" ? 100 : 0;
          setOptional(frontmatter, "goal-parent", input.parentId ? wikiLinkForPath(input.parentId) : undefined);
          setOptional(frontmatter, "goal-parent-id", parent?.stableId);
          setOptional(frontmatter, "goal-start-time", isWorkType(input.type) ? input.scheduledStartTime : undefined);
          setOptional(frontmatter, "goal-end-time", isWorkType(input.type) ? input.scheduledEndTime : undefined);
          setOptionalNumber(frontmatter, "goal-planned-minutes", isWorkType(input.type) ? input.plannedMinutes : undefined);
          setOptionalBoolean(frontmatter, "goal-meeting", isWorkType(input.type) && input.isMeeting ? true : undefined);
          if (recurrence === "none") {
            clearRecurrenceProperties(frontmatter);
          } else {
            frontmatter["goal-recurrence"] = recurrence;
            frontmatter["goal-recurrence-interval"] = positiveInteger(input.recurrenceInterval, 1);
            setOptionalNumberList(frontmatter, "goal-recurrence-weekdays", normalizeWeekdays(input.recurrenceWeekdays));
            setOptionalNumber(frontmatter, "goal-recurrence-target", recurrence === "weekly-target"
              ? positiveInteger(input.recurrenceTarget, 1)
              : undefined);
            setOptional(frontmatter, "goal-recurrence-start", isGeneratedRecurrence(recurrence)
              ? input.recurrenceStart ?? node.recurrenceStart ?? input.start ?? node.start ?? localDateIso()
              : undefined);
            setOptional(frontmatter, "goal-recurrence-end", input.recurrenceEnd);
            frontmatter["goal-series-id"] = node.seriesId;
          }
          delete frontmatter["goal-weight"];
        });
      }
    }
  }

  async reparent(node: GoalNode, parent: GoalNode): Promise<void> {
    const file = this.fileForNode(node);
    if (!file) throw new Error("The item note could not be found.");
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter["goal-parent"] = wikiLinkForPath(parent.id);
      frontmatter["goal-parent-id"] = parent.stableId;
    });
  }

  async duplicate(node: GoalNode): Promise<TFile> {
    return this.create({
      title: `${node.title} Copy`,
      type: node.type,
      parentId: node.parentId,
      start: node.start,
      scheduled: node.scheduled,
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
      recurrenceEnd: node.recurrenceEnd
    });
  }

  async setStatus(node: GoalNode, status: ManualStatus): Promise<void> {
    if (node.type === "area") return;
    const file = this.fileForNode(node);
    if (!file) return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter["goal-status"] = status;
      if (status === "completed") {
        frontmatter["goal-progress"] = 100;
        frontmatter["goal-completed"] = localIsoDateTime();
      } else {
        if (status === "not-started" || status === "cancelled") {
          frontmatter["goal-progress"] = 0;
        } else if (status === "in-progress" && numberValue(frontmatter["goal-progress"], 0) >= 100) {
          frontmatter["goal-progress"] = 0;
        }
        delete frontmatter["goal-completed"];
        delete frontmatter["goal-archived"];
      }
    });
  }

  async createNextOccurrence(node: GoalNode, today: string): Promise<TFile | undefined> {
    if (!isWorkType(node.type) || node.recurrence === "none" || isGeneratedRecurrence(node.recurrence)) return undefined;
    const base = node.scheduled ?? node.start ?? node.due ?? today;
    const next = nextRecurrenceDate(base, node.recurrence, node.recurrenceInterval);
    if (!next) return undefined;
    if (node.recurrenceEnd && next > node.recurrenceEnd) return undefined;
    const shift = daysBetween(base, next);
    return this.create({
      title: node.title,
      type: node.type,
      parentId: node.parentId,
      start: shiftIsoDate(node.start, shift),
      scheduled: shiftIsoDate(node.scheduled, shift) ?? next,
      scheduledStartTime: node.scheduledStartTime,
      scheduledEndTime: node.scheduledEndTime,
      plannedMinutes: node.plannedMinutes,
      isMeeting: node.isMeeting,
      due: shiftIsoDate(node.due, shift),
      severity: node.severity,
      recurrence: node.recurrence,
      recurrenceInterval: node.recurrenceInterval,
      recurrenceWeekdays: node.recurrenceWeekdays,
      recurrenceTarget: node.recurrenceTarget,
      recurrenceStart: node.recurrenceStart,
      recurrenceEnd: node.recurrenceEnd,
      seriesId: node.seriesId ?? node.stableId
    });
  }

  async ensureRecurringOccurrences(forest: GoalForest, today: string): Promise<number> {
    const series = new Map<string, GoalNode[]>();
    for (const node of forest.all) {
      if (!isWorkType(node.type) || !node.seriesId || !isGeneratedRecurrence(node.recurrence)) continue;
      const members = series.get(node.seriesId) ?? [];
      members.push(node);
      series.set(node.seriesId, members);
      if (node.recurrenceKey) this.generatedRecurrenceKeys.add(node.recurrenceKey);
    }

    let created = 0;
    for (const [seriesId, members] of series) {
      const template = [...members].sort((a, b) => occurrenceSortKey(b).localeCompare(occurrenceSortKey(a)))[0];
      const legacyOccurrenceDates = new Set(
        members
          .filter((member) => !member.recurrenceKey)
          .map((member) => member.scheduled ?? member.start ?? member.due)
          .filter((date): date is string => Boolean(date))
      );
      const seriesStart = template.recurrenceStart ?? template.start ?? template.scheduled ?? today;
      const plans = planRecurringOccurrences(
        seriesId,
        template.recurrence,
        today,
        seriesStart,
        template.recurrenceEnd,
        template.recurrenceWeekdays,
        template.recurrenceTarget,
        this.settings().weekStartsOn
      );
      for (const plan of plans) {
        if (this.generatedRecurrenceKeys.has(plan.key)) continue;
        if (legacyOccurrenceDates.has(plan.scheduled ?? plan.start)) continue;
        this.generatedRecurrenceKeys.add(plan.key);
        try {
          await this.create({
            title: template.title,
            type: template.type,
            parentId: template.parentId,
            start: plan.start,
            scheduled: plan.scheduled,
            scheduledStartTime: template.scheduledStartTime,
            scheduledEndTime: template.scheduledEndTime,
            plannedMinutes: template.plannedMinutes,
            isMeeting: template.isMeeting,
            due: template.recurrence === "weekly-target" ? plan.due : template.due,
            severity: template.severity,
            recurrence: template.recurrence,
            recurrenceInterval: template.recurrenceInterval,
            recurrenceWeekdays: template.recurrenceWeekdays,
            recurrenceTarget: template.recurrenceTarget,
            recurrenceStart: seriesStart,
            recurrenceEnd: template.recurrenceEnd,
            recurrenceKey: plan.key,
            recurrenceOrdinal: plan.ordinal,
            seriesId
          });
          created += 1;
        } catch (error) {
          this.generatedRecurrenceKeys.delete(plan.key);
          throw error;
        }
      }
    }
    return created;
  }

  async setArchived(node: GoalNode, archived: boolean): Promise<void> {
    const file = this.fileForNode(node);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (archived) frontmatter["goal-archived"] = true;
      else delete frontmatter["goal-archived"];
    });
  }

  async stopRecurrence(node: GoalNode): Promise<number> {
    const members = node.seriesId
      ? this.load(localDateIso()).all.filter((candidate) => candidate.seriesId === node.seriesId)
      : [node];
    let updated = 0;
    for (const member of members) {
      const file = this.fileForNode(member);
      if (!file) continue;
      await this.app.fileManager.processFrontMatter(file, clearRecurrenceProperties);
      updated += 1;
    }
    if (node.seriesId) {
      for (const key of [...this.generatedRecurrenceKeys]) {
        if (key.startsWith(`${node.seriesId}:`)) this.generatedRecurrenceKeys.delete(key);
      }
    }
    return updated;
  }

  async deleteNodes(nodes: GoalNode[]): Promise<number> {
    const files = [...new Map(
      nodes
        .map((node) => this.fileForNode(node))
        .filter((file): file is TFile => Boolean(file))
        .map((file) => [file.path, file])
    ).values()].sort((a, b) => b.path.length - a.path.length);
    for (const file of files) await this.app.fileManager.trashFile(file);
    return files.length;
  }

  async syncCalculatedProperties(forest: GoalForest): Promise<number> {
    let updated = 0;
    const byPath = new Map(forest.all.map((node) => [node.id, node]));

    for (const node of forest.all) {
      const file = this.fileForNode(node);
      if (!file) continue;
      const cached = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      const parentStableId = node.parentId ? byPath.get(node.parentId)?.stableId : undefined;
      const isArea = node.type === "area";
      const hasDisallowedSchedule = !isWorkType(node.type) && cached?.["goal-scheduled"] !== undefined;
      const hasDisallowedDates = !hasPlanningDates(node.type) && (
        cached?.["goal-start"] !== undefined || cached?.["goal-due"] !== undefined
      );
      const hasDisallowedWorkTime = !isWorkType(node.type) && (
        cached?.["goal-start-time"] !== undefined ||
        cached?.["goal-end-time"] !== undefined ||
        cached?.["goal-planned-minutes"] !== undefined ||
        cached?.["goal-meeting"] !== undefined
      );
      const needsUpdate =
        textValue(cached?.["goal-id"]) !== node.stableId ||
        Number(cached?.["goal-rollup-progress"]) !== node.metrics.progress ||
        textValue(cached?.["goal-rollup-status"]) !== node.metrics.status ||
        textValue(cached?.["goal-rollup-health"]) !== node.metrics.health ||
        textValue(cached?.["goal-type"]) !== node.type ||
        (!isArea && textValue(cached?.["goal-severity"]) !== node.severity) ||
        textValue(cached?.["goal-parent-id"]) !== (parentStableId ?? "") ||
        (isArea && textValue(cached?.["goal-status"]) !== "ongoing") ||
        hasLegacyProgressProperties(cached) ||
        (!isArea && Number(cached?.["goal-progress"]) !== (node.manualStatus === "completed" ? 100 : 0)) ||
        (isArea && (
          cached?.["goal-start"] !== undefined ||
          cached?.["goal-due"] !== undefined ||
          cached?.["goal-completed"] !== undefined ||
          cached?.["goal-progress"] !== undefined ||
          cached?.["goal-severity"] !== undefined ||
          cached?.["goal-target-value"] !== undefined ||
          cached?.["goal-current-value"] !== undefined ||
          cached?.["goal-metric-unit"] !== undefined ||
          cached?.["goal-time-target-minutes"] !== undefined ||
          cached?.["goal-recurrence"] !== undefined ||
          cached?.["goal-recurrence-interval"] !== undefined ||
          cached?.["goal-recurrence-weekdays"] !== undefined ||
          cached?.["goal-recurrence-target"] !== undefined ||
          cached?.["goal-recurrence-start"] !== undefined ||
          cached?.["goal-recurrence-end"] !== undefined ||
          cached?.["goal-recurrence-key"] !== undefined ||
          cached?.["goal-recurrence-ordinal"] !== undefined ||
          cached?.["goal-series-id"] !== undefined
        )) ||
        hasDisallowedSchedule ||
        hasDisallowedDates ||
        hasDisallowedWorkTime ||
        cached?.["goal-rollup-focus-minutes"] !== undefined ||
        cached?.["goal-rollup-pomodoros"] !== undefined ||
        cached?.["goal-focus-minutes"] !== undefined ||
        cached?.["goal-pomodoros"] !== undefined ||
        cached?.["goal-last-focused"] !== undefined ||
        cached?.["goal-weight"] !== undefined;
      if (!needsUpdate) continue;

      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter["goal-id"] = node.stableId;
        frontmatter["goal-rollup-progress"] = node.metrics.progress;
        frontmatter["goal-rollup-status"] = node.metrics.status;
        frontmatter["goal-rollup-health"] = node.metrics.health;
        delete frontmatter["goal-rollup-focus-minutes"];
        delete frontmatter["goal-rollup-pomodoros"];
        delete frontmatter["goal-focus-minutes"];
        delete frontmatter["goal-pomodoros"];
        delete frontmatter["goal-last-focused"];
        frontmatter["goal-type"] = node.type;
        if (isArea) delete frontmatter["goal-severity"];
        else frontmatter["goal-severity"] = node.severity;
        deleteLegacyProgressProperties(frontmatter);
        setOptional(frontmatter, "goal-parent-id", parentStableId);
        if (isArea) {
          frontmatter["goal-status"] = "ongoing";
          delete frontmatter["goal-start"];
          delete frontmatter["goal-due"];
          delete frontmatter["goal-completed"];
          delete frontmatter["goal-progress"];
          delete frontmatter["goal-target-value"];
          delete frontmatter["goal-current-value"];
          delete frontmatter["goal-metric-unit"];
          delete frontmatter["goal-time-target-minutes"];
          delete frontmatter["goal-recurrence"];
          delete frontmatter["goal-recurrence-interval"];
          delete frontmatter["goal-recurrence-weekdays"];
          delete frontmatter["goal-recurrence-target"];
          delete frontmatter["goal-recurrence-start"];
          delete frontmatter["goal-recurrence-end"];
          delete frontmatter["goal-recurrence-key"];
          delete frontmatter["goal-recurrence-ordinal"];
          delete frontmatter["goal-series-id"];
        } else {
          frontmatter["goal-progress"] = node.manualStatus === "completed" ? 100 : 0;
        }
        if (!isWorkType(node.type)) {
          delete frontmatter["goal-scheduled"];
          delete frontmatter["goal-start-time"];
          delete frontmatter["goal-end-time"];
          delete frontmatter["goal-planned-minutes"];
          delete frontmatter["goal-meeting"];
        }
        if (!hasPlanningDates(node.type)) {
          delete frontmatter["goal-start"];
          delete frontmatter["goal-due"];
        }
        delete frontmatter["goal-weight"];
      });
      updated += 1;
    }

    return updated;
  }

  async ensureIdentities(forest: GoalForest): Promise<number> {
    let updated = 0;
    const byPath = new Map(forest.all.map((node) => [node.id, node]));
    for (const node of forest.all) {
      const file = this.fileForNode(node);
      if (!file) continue;
      const cached = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      const parentStableId = node.parentId ? byPath.get(node.parentId)?.stableId : undefined;
      const isArea = node.type === "area";
      const progressFieldsAreNormalized = !hasLegacyProgressProperties(cached) && (
        isArea
          ? cached?.["goal-progress"] === undefined
          : Number(cached?.["goal-progress"]) === (node.manualStatus === "completed" ? 100 : 0)
      );
      const hierarchyFieldsAreNormalized = !isArea
        ? (hasPlanningDates(node.type) || (
            cached?.["goal-start"] === undefined &&
            cached?.["goal-due"] === undefined
          )) && (isWorkType(node.type) || (
            cached?.["goal-scheduled"] === undefined &&
            cached?.["goal-start-time"] === undefined &&
            cached?.["goal-end-time"] === undefined &&
            cached?.["goal-planned-minutes"] === undefined &&
            cached?.["goal-meeting"] === undefined
          )) && progressFieldsAreNormalized
        : textValue(cached?.["goal-status"]) === "ongoing" &&
          cached?.["goal-start"] === undefined &&
          cached?.["goal-scheduled"] === undefined &&
          cached?.["goal-due"] === undefined &&
          cached?.["goal-completed"] === undefined &&
          cached?.["goal-progress"] === undefined &&
          cached?.["goal-severity"] === undefined &&
          cached?.["goal-target-value"] === undefined &&
          cached?.["goal-current-value"] === undefined &&
          cached?.["goal-metric-unit"] === undefined &&
          cached?.["goal-time-target-minutes"] === undefined &&
          cached?.["goal-recurrence"] === undefined &&
          cached?.["goal-recurrence-interval"] === undefined &&
          cached?.["goal-recurrence-weekdays"] === undefined &&
          cached?.["goal-recurrence-target"] === undefined &&
          cached?.["goal-recurrence-start"] === undefined &&
          cached?.["goal-recurrence-end"] === undefined &&
          cached?.["goal-recurrence-key"] === undefined &&
          cached?.["goal-recurrence-ordinal"] === undefined &&
          cached?.["goal-series-id"] === undefined &&
          cached?.["goal-meeting"] === undefined &&
          progressFieldsAreNormalized;
      if (
        textValue(cached?.["goal-id"]) === node.stableId &&
        textValue(cached?.["goal-parent-id"]) === (parentStableId ?? "") &&
        hierarchyFieldsAreNormalized
      ) continue;
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter["goal-id"] = node.stableId;
        setOptional(frontmatter, "goal-parent-id", parentStableId);
        deleteLegacyProgressProperties(frontmatter);
        if (isArea) {
          frontmatter["goal-status"] = "ongoing";
          delete frontmatter["goal-start"];
          delete frontmatter["goal-scheduled"];
          delete frontmatter["goal-due"];
          delete frontmatter["goal-completed"];
          delete frontmatter["goal-progress"];
          delete frontmatter["goal-severity"];
          delete frontmatter["goal-target-value"];
          delete frontmatter["goal-current-value"];
          delete frontmatter["goal-metric-unit"];
          delete frontmatter["goal-time-target-minutes"];
          delete frontmatter["goal-recurrence"];
          delete frontmatter["goal-recurrence-interval"];
          delete frontmatter["goal-recurrence-weekdays"];
          delete frontmatter["goal-recurrence-target"];
          delete frontmatter["goal-recurrence-start"];
          delete frontmatter["goal-recurrence-end"];
          delete frontmatter["goal-recurrence-key"];
          delete frontmatter["goal-recurrence-ordinal"];
          delete frontmatter["goal-series-id"];
        } else {
          frontmatter["goal-progress"] = node.manualStatus === "completed" ? 100 : 0;
          if (!isWorkType(node.type)) {
            delete frontmatter["goal-scheduled"];
            delete frontmatter["goal-start-time"];
            delete frontmatter["goal-end-time"];
            delete frontmatter["goal-planned-minutes"];
          }
          if (!hasPlanningDates(node.type)) {
            delete frontmatter["goal-start"];
            delete frontmatter["goal-due"];
          }
        }
      });
      updated += 1;
    }
    return updated;
  }

  async repairHierarchy(forest: GoalForest): Promise<RepairResult> {
    const updated = await this.syncCalculatedProperties(forest);
    const unresolved = forest.all.filter((node) => node.type !== "area" && !node.parentId).length;
    return { updated, unresolved };
  }

  async organizeIntoHierarchy(forest: GoalForest): Promise<OrganizeResult> {
    const baseFolder = normalizedFolder(this.settings().goalsFolder);
    await this.ensureFolder(baseFolder);
    const targets = new Map<string, string>();
    const reserved = new Set<string>();

    const reserveTarget = (folder: string, title: string): string => {
      const base = sanitizeFileName(title);
      let index = 1;
      while (true) {
        const suffix = index === 1 ? "" : ` ${index}`;
        const candidate = normalizePath(`${folder ? `${folder}/` : ""}${base}${suffix}.md`);
        if (!reserved.has(candidate)) {
          reserved.add(candidate);
          return candidate;
        }
        index += 1;
      }
    };

    const plan = (node: GoalNode, folder: string): void => {
      const target = reserveTarget(folder, node.title);
      targets.set(node.id, target);
      const childrenFolder = target.replace(/\.md$/i, "");
      for (const child of node.children) plan(child, childrenFolder);
    };
    for (const root of forest.roots) plan(root, baseFolder);

    const files = new Map<string, TFile>();
    for (const node of forest.all) {
      const file = this.fileForNode(node);
      if (file) files.set(node.id, file);
    }

    let moved = 0;
    let skipped = 0;
    for (const node of forest.all) {
      const file = files.get(node.id);
      const target = targets.get(node.id);
      if (!file || !target || file.path === target) continue;
      const targetFolder = target.split("/").slice(0, -1).join("/");
      await this.ensureFolder(targetFolder);
      const collision = this.app.vault.getAbstractFileByPath(target);
      if (collision && collision !== file) {
        skipped += 1;
        continue;
      }
      await this.app.fileManager.renameFile(file, target);
      moved += 1;
    }

    return { moved, skipped };
  }

  fileForNode(node: GoalNode): TFile | null {
    const abstractFile = this.app.vault.getAbstractFileByPath(node.id);
    return abstractFile instanceof TFile ? abstractFile : null;
  }

  async createStarterTree(today: string): Promise<void> {
    const endOfWeek = addDays(today, 6);
    const definitions: Array<Partial<NewGoalInput> & { key: string; title: string; type: GoalType; parent?: string }> = [
      { key: "religion", title: "Religion", type: "area" },
      { key: "family", title: "Family", type: "area" },
      { key: "self-development", title: "Self Development", type: "area" },
      { key: "work", title: "Work", type: "area" },
      { key: "finance", title: "Finance", type: "area" },
      { key: "memorize-quran", title: "Memorize the Quran", type: "goal", parent: "religion", severity: "high" },
      { key: "learn-tajweed", title: "Learn Tajweed", type: "goal", parent: "memorize-quran" },
      { key: "juz-amma", title: "Memorize Juz Amma", type: "goal", parent: "memorize-quran", severity: "high" },
      { key: "tajweed-book", title: "Read a Tajweed Book", type: "project", parent: "learn-tajweed", start: today },
      {
        key: "ten-pages",
        title: "Read 10 Pages This Week",
        type: "task",
        parent: "tajweed-book",
        start: today,
        scheduled: today,
        due: endOfWeek
      },
      {
        key: "one-page",
        title: "Read One Page Today",
        type: "subtask",
        parent: "ten-pages",
        start: today,
        recurrence: "weekdays"
      }
    ];

    const created = new Map<string, string>();
    for (const definition of definitions) {
      const parentId = definition.parent ? created.get(definition.parent) : undefined;
      const file = await this.create({
        title: definition.title,
        type: definition.type,
        parentId,
        start: definition.start,
        scheduled: definition.scheduled,
        due: definition.due,
        severity: definition.severity ?? this.settings().defaultSeverity,
        recurrence: definition.recurrence ?? "none",
        recurrenceInterval: definition.recurrenceInterval ?? 1,
      });
      created.set(definition.key, file.path);
    }
  }

  private nodeByPath(path: string): GoalNode | undefined {
    return this.load(localDateIso()).all.find((node) => node.id === path);
  }

  private stableIdForPath(path: string, raw: unknown): string {
    const existing = optionalText(raw);
    if (existing) {
      this.generatedIds.set(path, existing);
      return existing;
    }
    const generated = this.generatedIds.get(path) ?? randomId();
    this.generatedIds.set(path, generated);
    return generated;
  }

  private resolveParent(file: TFile, rawParent: unknown): string | undefined {
    const raw = optionalText(Array.isArray(rawParent) ? rawParent[0] : rawParent);
    if (!raw) return undefined;
    const linkpath = raw
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .split("|")[0]
      .split("#")[0]
      .trim();
    if (!linkpath) return undefined;

    const resolved = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
    if (resolved) return resolved.path;

    const normalized = normalizePath(linkpath.endsWith(".md") ? linkpath : `${linkpath}.md`);
    const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
    return abstractFile instanceof TFile ? abstractFile.path : undefined;
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder) return;
    const segments = folder.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing instanceof TAbstractFile) {
        throw new Error(`Cannot create the Goal Tree folder because "${current}" is a file.`);
      }
      await this.app.vault.createFolder(current);
    }
  }

  private folderForParent(parentId?: string): string {
    const baseFolder = normalizedFolder(this.settings().goalsFolder);
    if (!parentId) return baseFolder;
    const parent = this.app.vault.getAbstractFileByPath(parentId);
    if (!(parent instanceof TFile)) return baseFolder;
    return normalizePath(childFolderForGoalPath(parent.path));
  }

  private async uniquePath(folder: string, title: string): Promise<string> {
    let index = 1;
    while (true) {
      const suffix = index === 1 ? "" : ` ${index}`;
      const candidate = normalizePath(`${folder ? `${folder}/` : ""}${title}${suffix}.md`);
      if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
      index += 1;
    }
  }
}

function normalizedFolder(value: string): string {
  const normalized = normalizePath(value.trim());
  return normalized === "/" || normalized === "." ? "" : normalized.replace(/^\/+|\/+$/g, "");
}

function isEnabled(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === "true";
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function optionalText(value: unknown): string | undefined {
  const text = textValue(value);
  return text || undefined;
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNonNegative(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function optionalPositive(value: unknown): number | undefined {
  const number = optionalNonNegative(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function isoDate(value: unknown): string | undefined {
  const match = textValue(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0];
}

function timeValue(value: unknown): string | undefined {
  const time = textValue(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : undefined;
}

function goalType(value: unknown): GoalType {
  const normalized = textValue(value).toLowerCase();
  if (normalized === "area" || normalized === "goal" || normalized === "project") return normalized;
  if (normalized === "milestone") return "project";
  if (normalized === "subtask" || normalized === "daily-task" || normalized === "daily task") return "subtask";
  return "task";
}

function goalSeverity(value: unknown, legacyWeight: unknown): GoalSeverity {
  const text = textValue(value).toLowerCase();
  if (text === "low" || text === "medium" || text === "high" || text === "critical") return text;
  if (legacyWeight !== null && legacyWeight !== undefined && legacyWeight !== "") {
    return severityFromLegacyWeight(numberValue(legacyWeight, 2));
  }
  return "medium";
}

function repairObviousWorkChildTypes(records: GoalInput[]): void {
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    if (!record.parentId) continue;
    const parent = byId.get(record.parentId);
    if (!parent || canParentType(parent.type, record.type)) continue;
    if (parent.type === "task" || parent.type === "subtask") record.type = "subtask";
  }
}

function manualStatus(value: unknown): ManualStatus {
  const normalized = textValue(value).toLowerCase().replace(/\s+/g, "-");
  if (normalized === "completed" || normalized === "done") return "completed";
  if (normalized === "in-progress" || normalized === "active") return "in-progress";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  return "not-started";
}

function sanitizeFileName(value: string): string {
  const sanitized = value.trim().replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ");
  return sanitized || "Untitled Goal";
}

function wikiLinkForPath(path: string): string {
  return `[[${path.replace(/\.md$/i, "")}]]`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function createGoalMarkdown(
  input: NewGoalInput & {
    stableId: string;
    parentLink?: string;
    parentStableId?: string;
  }
): string {
  const properties = [
    "---",
    "goal-tree: true",
    `goal-id: ${yamlString(input.stableId)}`,
    `goal-title: ${yamlString(input.title)}`,
    `goal-type: ${input.type}`,
    `goal-status: ${input.type === "area" ? "ongoing" : "not-started"}`,
    ...(input.type === "area" ? [] : ["goal-progress: 0"]),
    ...(input.type === "area" ? [] : [`goal-severity: ${normalizeSeverity(input.severity)}`]),
    `goal-created: ${localIsoDateTime()}`
  ];
  if (input.parentLink) properties.push(`goal-parent: ${yamlString(input.parentLink)}`);
  if (input.parentStableId) properties.push(`goal-parent-id: ${yamlString(input.parentStableId)}`);
  if (hasPlanningDates(input.type) && input.start) properties.push(`goal-start: ${input.start}`);
  if (isWorkType(input.type) && input.scheduled) properties.push(`goal-scheduled: ${input.scheduled}`);
  if (isWorkType(input.type) && input.scheduledStartTime) properties.push(`goal-start-time: ${input.scheduledStartTime}`);
  if (isWorkType(input.type) && input.scheduledEndTime) properties.push(`goal-end-time: ${input.scheduledEndTime}`);
  if (isWorkType(input.type) && input.plannedMinutes) properties.push(`goal-planned-minutes: ${input.plannedMinutes}`);
  if (isWorkType(input.type) && input.isMeeting) properties.push("goal-meeting: true");
  if (hasPlanningDates(input.type) && input.due) properties.push(`goal-due: ${input.due}`);
  if (input.recurrence !== "none") {
    properties.push(`goal-recurrence: ${input.recurrence}`);
    properties.push(`goal-recurrence-interval: ${positiveInteger(input.recurrenceInterval, 1)}`);
    if (input.recurrenceWeekdays && input.recurrenceWeekdays.length > 0) {
      properties.push(`goal-recurrence-weekdays: [${normalizeWeekdays(input.recurrenceWeekdays).join(", ")}]`);
    }
    if (input.recurrence === "weekly-target") {
      properties.push(`goal-recurrence-target: ${positiveInteger(input.recurrenceTarget, 1)}`);
    }
    if (input.recurrenceStart) properties.push(`goal-recurrence-start: ${input.recurrenceStart}`);
    if (input.recurrenceEnd) properties.push(`goal-recurrence-end: ${input.recurrenceEnd}`);
    if (input.recurrenceKey) properties.push(`goal-recurrence-key: ${yamlString(input.recurrenceKey)}`);
    if (input.recurrenceOrdinal) properties.push(`goal-recurrence-ordinal: ${positiveInteger(input.recurrenceOrdinal, 1)}`);
    if (input.seriesId) properties.push(`goal-series-id: ${yamlString(input.seriesId)}`);
  }
  properties.push(
    "goal-rollup-progress: 0",
    `goal-rollup-status: ${input.type === "area" ? "ongoing" : "not-started"}`,
    "goal-rollup-health: on-track",
    "---",
    "",
    `# ${input.title}`,
    "",
    "## Notes",
    ""
  );
  return properties.join("\n");
}

function setOptional(frontmatter: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value) frontmatter[key] = value;
  else delete frontmatter[key];
}

function setOptionalBoolean(frontmatter: Record<string, unknown>, key: string, value: boolean | undefined): void {
  if (value === undefined) delete frontmatter[key];
  else frontmatter[key] = value;
}

function setOptionalNumber(frontmatter: Record<string, unknown>, key: string, value: number | undefined): void {
  if (value !== undefined && Number.isFinite(value)) frontmatter[key] = value;
  else delete frontmatter[key];
}

function setOptionalNumberList(frontmatter: Record<string, unknown>, key: string, value: number[]): void {
  if (value.length > 0) frontmatter[key] = value;
  else delete frontmatter[key];
}

function clearRecurrenceProperties(frontmatter: Record<string, unknown>): void {
  delete frontmatter["goal-recurrence"];
  delete frontmatter["goal-recurrence-interval"];
  delete frontmatter["goal-recurrence-weekdays"];
  delete frontmatter["goal-recurrence-target"];
  delete frontmatter["goal-recurrence-start"];
  delete frontmatter["goal-recurrence-end"];
  delete frontmatter["goal-recurrence-key"];
  delete frontmatter["goal-recurrence-ordinal"];
  delete frontmatter["goal-series-id"];
}

const LEGACY_PROGRESS_PROPERTIES = [
  "goal-progress-mode",
  "goal-target-value",
  "goal-current-value",
  "goal-metric-unit",
  "goal-time-target-minutes"
] as const;

function hasLegacyProgressProperties(frontmatter: Record<string, unknown> | undefined): boolean {
  return LEGACY_PROGRESS_PROPERTIES.some((key) => frontmatter?.[key] !== undefined);
}

function deleteLegacyProgressProperties(frontmatter: Record<string, unknown>): void {
  for (const key of LEGACY_PROGRESS_PROPERTIES) delete frontmatter[key];
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

function recurrenceDue(rule: RecurrenceRule, requested: string | undefined, planned: string | undefined): string | undefined {
  return requested ?? (rule === "weekly-target" ? planned : undefined);
}

function occurrenceSortKey(node: GoalNode): string {
  return node.scheduled ?? node.start ?? node.createdAt ?? node.id;
}

function weekdayNumbers(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/^\[|\]$/g, "").split(",")
      : [];
  return normalizeWeekdays(raw.map((entry) => Number(entry)));
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function localDateIso(date = new Date()): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function localIsoDateTime(date = new Date()): string {
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().replace(/Z$/, "");
}

function randomId(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") return cryptoObject.randomUUID();
  return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
