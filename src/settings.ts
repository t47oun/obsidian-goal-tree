import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { GoalTreeSettings } from "./repository";

export interface SettingsHost {
  settings: GoalTreeSettings;
  saveSettings(): Promise<void>;
  refreshAll(): Promise<void>;
}

export class GoalTreeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Goals folder")
      .setDesc("Only Markdown files in this folder are used. The folder is created when needed.")
      .addText((text) =>
        text
          .setPlaceholder("Goal Tree")
          .setValue(this.host.settings.goalsFolder)
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (!trimmed) return;
            this.host.settings.goalsFolder = trimmed;
            await this.host.saveSettings();
            await this.host.refreshAll();
          })
      );

    new Setting(containerEl)
      .setName("Default severity")
      .setDesc("Used for newly created items. Severity controls how strongly each child affects its parent progress.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("low", "Low")
          .addOption("medium", "Medium")
          .addOption("high", "High")
          .addOption("critical", "Critical")
          .setValue(this.host.settings.defaultSeverity)
          .onChange(async (value) => {
          this.host.settings.defaultSeverity = value as GoalTreeSettings["defaultSeverity"];
          await this.host.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Sync calculated properties")
      .setDesc("Write roll-up progress, status, and health back to each goal note for use in Properties and queries.")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.syncCalculatedProperties).onChange(async (value) => {
          this.host.settings.syncCalculatedProperties = value;
          await this.host.saveSettings();
          await this.host.refreshAll();
        })
      );

    new Setting(containerEl).setName("Calendar and Kanban").setHeading();

    new Setting(containerEl)
      .setName("Include available work in Today")
      .setDesc("Show unscheduled tasks whose Start–Due window includes today.")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.todayIncludeAvailable).onChange(async (value) => {
          this.host.settings.todayIncludeAvailable = value;
          await this.host.saveSettings();
          await this.host.refreshAll();
        })
      );

    new Setting(containerEl)
      .setName("Start week on")
      .setDesc("Controls the first day shown in Calendar and Weekly Kanban.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("saturday", "Saturday")
          .addOption("sunday", "Sunday")
          .addOption("monday", "Monday")
          .setValue(this.host.settings.weekStartsOn)
          .onChange(async (value) => {
            this.host.settings.weekStartsOn = value as GoalTreeSettings["weekStartsOn"];
            await this.host.saveSettings();
            await this.host.refreshAll();
          })
      );

    new Setting(containerEl).setName("Kanban").setHeading();

    new Setting(containerEl)
      .setName("Default period")
      .setDesc("Period selected when a Goal Tree view opens.")
      .addDropdown((dropdown) => dropdown
        .addOption("daily", "Daily")
        .addOption("weekly", "Weekly")
        .addOption("monthly", "Monthly")
        .addOption("quarterly", "Quarterly")
        .addOption("yearly", "Yearly")
        .setValue(this.host.settings.kanbanDefaultScope)
        .onChange(async (value) => {
          this.host.settings.kanbanDefaultScope = value as GoalTreeSettings["kanbanDefaultScope"];
          await this.host.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Default item view")
      .setDesc("Show the work hierarchy or one item type.")
      .addDropdown((dropdown) => dropdown
        .addOption("hierarchy", "Project › Task › Subtask")
        .addOption("project", "Projects only")
        .addOption("task", "Tasks only")
        .addOption("subtask", "Subtasks only")
        .setValue(this.host.settings.kanbanDefaultDisplay)
        .onChange(async (value) => {
          this.host.settings.kanbanDefaultDisplay = value as GoalTreeSettings["kanbanDefaultDisplay"];
          await this.host.saveSettings();
        }));

    this.addKanbanToggle("Show completed", "Include the Completed column's cards.", "kanbanShowCompleted");
    this.addKanbanToggle("Show unscheduled", "Include work without a planning date in every period.", "kanbanShowUnscheduled");
    this.addKanbanToggle("Show parent path", "Show the Area, Goal, and Project path on cards.", "kanbanShowParentPath");
    this.addKanbanToggle("Show severity", "Show the severity label on cards.", "kanbanShowSeverity");
    this.addKanbanToggle("Show time", "Show specific, planned, and actual time on cards.", "kanbanShowTime");
    this.addKanbanToggle("Show due date", "Show deadline details on cards.", "kanbanShowDueDate");

    new Setting(containerEl).setName("Calculation rule").setHeading();
    new Setting(containerEl).setDesc(
      "Progress always uses child Severity: Low 1, Medium 2, High 3, and Critical 4. Completion and deadline health propagate through every ancestor."
    );
  }

  private addKanbanToggle(
    name: string,
    description: string,
    key: "kanbanShowCompleted" | "kanbanShowUnscheduled" | "kanbanShowParentPath" |
      "kanbanShowSeverity" | "kanbanShowTime" | "kanbanShowDueDate"
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addToggle((toggle) => toggle.setValue(this.host.settings[key]).onChange(async (value) => {
        this.host.settings[key] = value;
        await this.host.saveSettings();
        await this.host.refreshAll();
      }));
  }
}
