import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { GoalTreeSettings } from "./repository";

export interface SettingsHost {
  settings: GoalTreeSettings;
  saveSettings(): Promise<void>;
  refreshAll(): Promise<void>;
}

type SettingsSection = "general" | "planning" | "kanban" | "graph" | "lists" | "data";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export class GoalTreeSettingTab extends PluginSettingTab {
  private section: SettingsSection = "general";

  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("goal-tree-settings");
    const layout = containerEl.createDiv({ cls: "goal-tree-settings-layout" });
    const navigation = layout.createDiv({ cls: "goal-tree-settings-nav" });
    const content = layout.createDiv({ cls: "goal-tree-settings-content" });

    const sections: [SettingsSection, string][] = [
      ["general", "General"], ["planning", "Planning"], ["kanban", "Kanban"],
      ["graph", "Graph"], ["lists", "Lists"], ["data", "Data"]
    ];
    for (const [id, label] of sections) {
      const button = navigation.createEl("button", { text: label, cls: "goal-tree-settings-nav-button" });
      if (id === this.section) button.addClass("is-active");
      button.addEventListener("click", () => { this.section = id; this.display(); });
    }
    new Setting(content).setName(sections.find(([id]) => id === this.section)?.[1] ?? "Settings").setHeading();
    if (this.section === "general") this.renderGeneral(content);
    if (this.section === "planning") this.renderPlanning(content);
    if (this.section === "kanban") this.renderKanban(content);
    if (this.section === "graph") this.renderGraph(content);
    if (this.section === "lists") this.renderLists(content);
    if (this.section === "data") this.renderData(content);
  }

  private renderGeneral(container: HTMLElement): void {
    new Setting(container).setName("Goals folder").setDesc("Markdown notes managed by Goal Tree are stored here.")
      .addText((text) => text.setPlaceholder("Goal Tree").setValue(this.host.settings.goalsFolder).onChange(async (value) => {
        const trimmed = value.trim(); if (!trimmed) return;
        this.host.settings.goalsFolder = trimmed; await this.save(true);
      }));
    new Setting(container).setName("Default view").setDesc("The view opened when Goal Tree starts.")
      .addDropdown((dropdown) => {
        for (const view of ["overview", "today", "tree", "graph", "calendar", "kanban", "lists", "review"] as const) {
          dropdown.addOption(view, view[0].toUpperCase() + view.slice(1));
        }
        dropdown.setValue(this.host.settings.defaultView).onChange(async (value) => {
          this.host.settings.defaultView = value as GoalTreeSettings["defaultView"]; await this.save();
        });
      });
    new Setting(container).setName("Interface density").setDesc("Compact reduces spacing while preserving touch targets.")
      .addDropdown((dropdown) => dropdown.addOption("comfortable", "Comfortable").addOption("compact", "Compact")
        .setValue(this.host.settings.interfaceDensity).onChange(async (value) => {
          this.host.settings.interfaceDensity = value as GoalTreeSettings["interfaceDensity"]; await this.save(true);
        }));
    new Setting(container).setName("Default severity").setDesc("Used for new Goals, Projects, Tasks, and Subtasks.")
      .addDropdown((dropdown) => dropdown.addOption("low", "Low").addOption("medium", "Medium")
        .addOption("high", "High").addOption("critical", "Critical").setValue(this.host.settings.defaultSeverity)
        .onChange(async (value) => {
          this.host.settings.defaultSeverity = value as GoalTreeSettings["defaultSeverity"]; await this.save();
        }));
  }

  private renderPlanning(container: HTMLElement): void {
    new Setting(container).setName("Start week on").setDesc("Used by Calendar and weekly planning.")
      .addDropdown((dropdown) => dropdown.addOption("sunday", "Sunday").addOption("monday", "Monday")
        .addOption("saturday", "Saturday").setValue(this.host.settings.weekStartsOn).onChange(async (value) => {
          this.host.settings.weekStartsOn = value as GoalTreeSettings["weekStartsOn"]; await this.save(true);
        }));
    const days = new Setting(container).setName("Workdays").setDesc("Defaults to Sunday through Thursday.");
    for (let day = 0; day < 7; day += 1) {
      days.addToggle((toggle) => toggle.setTooltip(DAY_NAMES[day]).setValue(this.host.settings.workdays.includes(day))
        .onChange(async (enabled) => {
          const next = new Set(this.host.settings.workdays); if (enabled) next.add(day); else next.delete(day);
          this.host.settings.workdays = [...next].sort((a, b) => a - b); await this.save(true);
        }));
    }
    new Setting(container).setName("Time format").addDropdown((dropdown) => dropdown.addOption("12-hour", "12-hour")
      .addOption("24-hour", "24-hour").setValue(this.host.settings.timeFormat).onChange(async (value) => {
        this.host.settings.timeFormat = value as GoalTreeSettings["timeFormat"]; await this.save(true);
      }));
    this.toggle(container, "Include available work in Today", "Show unscheduled work when today is inside its Start–Due range.", "todayIncludeAvailable");
  }

  private renderKanban(container: HTMLElement): void {
    new Setting(container).setName("Default period").addDropdown((dropdown) => dropdown.addOption("daily", "Daily")
      .addOption("weekly", "Weekly").addOption("monthly", "Monthly").addOption("quarterly", "Quarterly")
      .addOption("yearly", "Yearly").setValue(this.host.settings.kanbanDefaultScope).onChange(async (value) => {
        this.host.settings.kanbanDefaultScope = value as GoalTreeSettings["kanbanDefaultScope"]; await this.save();
      }));
    new Setting(container).setName("Visible types").setDesc("Choose any combination.")
      .addToggle((toggle) => toggle.setTooltip("Projects").setValue(this.host.settings.kanbanShowProjects).onChange(async (value) => {
        this.host.settings.kanbanShowProjects = value; await this.save(true);
      })).addToggle((toggle) => toggle.setTooltip("Tasks").setValue(this.host.settings.kanbanShowTasks).onChange(async (value) => {
        this.host.settings.kanbanShowTasks = value; await this.save(true);
      })).addToggle((toggle) => toggle.setTooltip("Subtasks").setValue(this.host.settings.kanbanShowSubtasks).onChange(async (value) => {
        this.host.settings.kanbanShowSubtasks = value; await this.save(true);
      }));
    this.toggle(container, "Group by parent", "Keep Tasks and Subtasks connected to their parent Project.", "kanbanGroupByParent");
    this.toggle(container, "Show completed", "Include the Completed column.", "kanbanShowCompleted");
    this.toggle(container, "Show unscheduled", "Include work without a planning date.", "kanbanShowUnscheduled");
    this.toggle(container, "Show parent path", "Show Area, Goal, and Project context.", "kanbanShowParentPath");
    this.toggle(container, "Show severity", "Show severity on cards.", "kanbanShowSeverity");
    this.toggle(container, "Show time", "Show scheduled times on cards.", "kanbanShowTime");
    this.toggle(container, "Show due date", "Show deadlines on cards.", "kanbanShowDueDate");
    new Setting(container).setName("Completed order").addDropdown((dropdown) => dropdown.addOption("newest", "Newest first")
      .addOption("oldest", "Oldest first").addOption("manual", "Manual").setValue(this.host.settings.kanbanCompletedOrder)
      .onChange(async (value) => {
        this.host.settings.kanbanCompletedOrder = value as GoalTreeSettings["kanbanCompletedOrder"]; await this.save(true);
      }));
    new Setting(container).setName("Mobile layout").addDropdown((dropdown) => dropdown.addOption("swipe", "Swipe columns")
      .addOption("stack", "Stack columns").setValue(this.host.settings.kanbanMobileMode).onChange(async (value) => {
        this.host.settings.kanbanMobileMode = value as GoalTreeSettings["kanbanMobileMode"]; await this.save(true);
      }));
  }

  private renderGraph(container: HTMLElement): void {
    this.toggle(container, "Motion", "Animate the force layout and transitions.", "graphMotion");
    new Setting(container).setName("Labels").addDropdown((dropdown) => dropdown.addOption("selected", "Selected and connected")
      .addOption("hover", "On hover").addOption("all", "All").setValue(this.host.settings.graphLabels).onChange(async (value) => {
        this.host.settings.graphLabels = value as GoalTreeSettings["graphLabels"]; await this.save(true);
      }));
    new Setting(container).setName("Spacing").addDropdown((dropdown) => dropdown.addOption("compact", "Compact")
      .addOption("comfortable", "Comfortable").setValue(this.host.settings.graphSpacing).onChange(async (value) => {
        this.host.settings.graphSpacing = value as GoalTreeSettings["graphSpacing"]; await this.save(true);
      }));
  }

  private renderLists(container: HTMLElement): void {
    new Setting(container)
      .setName("Markdown storage")
      .setDesc(`Each list is a normal note in ${this.host.settings.goalsFolder}/Lists and survives plugin reinstallations.`);
    new Setting(container).setName("Finished item order").setDesc("Finished items always stay below unfinished items.")
      .addDropdown((dropdown) => dropdown.addOption("manual", "Manual").addOption("newest", "Newest first")
        .addOption("oldest", "Oldest first").setValue(this.host.settings.listsFinishedOrder).onChange(async (value) => {
          this.host.settings.listsFinishedOrder = value as GoalTreeSettings["listsFinishedOrder"]; await this.save(true);
        }));
    new Setting(container).setName("Promotion").setDesc("Convert a list item to a Goal, Project, Task, or Subtask. Completion remains synchronized.");
  }

  private renderData(container: HTMLElement): void {
    this.toggle(container, "Sync calculated properties", "Write progress, status, and health to Markdown properties.", "syncCalculatedProperties");
    this.toggle(container, "Confirm before delete", "Ask before deleting a Goal Tree item.", "confirmBeforeDelete");
    new Setting(container).setName("Progress calculation").setDesc("Always weighted by Severity: Low 1, Medium 2, High 3, Critical 4.");
    new Setting(container).setName("Completed work").setDesc("Completed items remain as Markdown notes and stay visible in Review.");
  }

  private toggle<K extends keyof GoalTreeSettings>(container: HTMLElement, name: string, description: string, key: K): void {
    new Setting(container).setName(name).setDesc(description).addToggle((toggle) => toggle
      .setValue(Boolean(this.host.settings[key])).onChange(async (value) => {
        this.host.settings[key] = value as GoalTreeSettings[K]; await this.save(true);
      }));
  }

  private async save(refresh = false): Promise<void> {
    await this.host.saveSettings(); if (refresh) await this.host.refreshAll();
  }
}
