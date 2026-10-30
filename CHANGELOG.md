# Changelog

## 0.13.1

- Fixed the Obsidian Community Plugins review-blocking settings heading by using the native Setting.setHeading() API.

## 0.13.0

- Added one unified Obsidian-native interface across Overview, Today, Tree, Graph, Calendar, Kanban, Lists, and Review.
- Added a shared item inspector on desktop and tablet, with a responsive bottom sheet on phones.
- Added inline note viewing and editing while keeping the full Markdown note one click away.
- Kept Life Areas permanent and neutral: no dates, status, severity, completion, or risk color.
- Redesigned Graph with compact nodes, curved connections, selected-branch emphasis, configurable labels and spacing, smoother zoom, touch pinch, pan, and drag.
- Added combinable Project, Task, and Subtask filters to Kanban, optional parent grouping, card ordering, mobile swipe/stack layouts, and three execution columns only.
- Added drag-to-reschedule for existing Calendar events in Month, Week, and Day views.
- Simplified Review to **Needs attention** and **Completed work**, with period and type filters plus clear health explanations.
- Expanded starter Lists with People of Interest, Documentaries, and Podcasts.
- Added configurable finished-list ordering while always keeping finished entries below unfinished entries.
- Restricted List promotion to Goal, Project, Task, or Subtask and preserved two-way completion synchronization.
- Reorganized settings into General, Planning, Kanban, Graph, Lists, and Data sections.
- Added configurable default view, interface density, Sunday–Thursday workdays, time format, graph behavior, delete confirmation, and responsive Kanban behavior.
- Removed planned-duration controls from the editor. Fixed meeting times remain supported and calculate their duration internally for compatibility.
- Added durable item notes and stable manual ordering properties without breaking existing Markdown data.
- Improved mobile and tablet layouts, touch targets, list dragging, settings navigation, modal alignment, and inspector behavior.
- Expanded automated tests for default Lists, finished ordering modes, and stored hierarchy order.

## 0.12.5

- Fixed List-to-Goal-Tree promotion failing when Obsidian had not indexed the newly created Markdown note yet.
- Prevented users from retrying a successful creation only because its List link was checked too early.

## 0.12.4

- Updated the minimum supported Obsidian version to 1.13.1 to match the APIs used by the plugin.
- Removed the redundant plugin-name heading from Goal Tree settings.
- Replaced the custom calculation heading with Obsidian's native settings heading component.
- Added the complete source and test folders required for Community Plugins build verification.

## 0.12.3

- Added manual ordering for personal List entries with a compact grip handle.
- Added desktop drag-and-drop and mobile/tablet long-press dragging.
- Added Move up and Move down menu actions as an accessible fallback.
- Kept active and finished entries in separate sections so completed work always remains below unfinished work.
- Preserved the chosen order independently inside the active and finished sections.

## 0.12.2

- Added a clear **Repeating task** toggle for Tasks and Subtasks so a normal task can become a habit without adding a new hierarchy type.
- Simplified recurrence setup with Times per week, Sunday–Saturday preferred-day chips, Until I stop it or a final date, and a live weekly completion summary.
- Made Add/Edit dialog titles match the selected type and changed parent choices to show their full Area › Goal › Project path.
- Restored Start and optional Due dates for Goals while keeping only Life Areas permanent and date-free.
- Removed the obsolete Weekly time target, Pomodoro, timer, focus-session storage, calculations, tests, and styles.
- Improved Graph zoom with animated wheel and button interpolation, cursor-centered scaling, and midpoint-anchored pinch zoom.
- Preserved cleanup of old timer and focus properties when existing notes are synchronized.

## 0.12.1

- Replaced the static radial Goal Graph with a responsive force-directed graph inspired by Obsidian Graph View.
- Added animated physics, smooth settling, node dragging, background panning, cursor-centered wheel zoom, touch pinch zoom, and reset controls.
- Reduced all node sizes to compact dots, with a smaller dark Goal Tree root and neutral gray Areas.
- Added live container resizing so the graph uses the available phone, tablet, or desktop width without a fixed canvas or horizontal scrollbar.
- Changed labels and edges to a lighter, quieter Obsidian-style presentation and honored reduced-motion accessibility preferences.

## 0.12.0

- Added an Obsidian-style interactive Graph view with Area, status, and depth filters, plus zoom and pan.
- Added simple personal Lists with starter lists, manual completion, automatic finished-item sorting, and promotion to Goal Tree items.
- Added Month, Week, and Day calendar modes with Sunday-first weeks, Anytime, timed, Due, and unscheduled work.
- Added a Meeting marker for Tasks and Subtasks so appointments remain inside their Project hierarchy.
- Rebuilt Review around completed work, habits, overdue items, at-risk items, and Area summaries.
- Made Areas permanently neutral and dark gray in the graph while preserving severity-based progress for all other levels.
- Removed Pomodoro and timer controls from the visible workspace and settings; task completion never depends on tracked time.
- Added responsive mobile and tablet layouts, touch-sized controls, horizontally scrollable navigation and calendars, and stacked panels.
- Added linked completion sync between Lists and Goal Tree, including safe unlinking when a Goal Tree note is deleted.

## 0.11.0

- Simplified planning dates: Projects, Tasks, and Subtasks require a Start date and use an optional Due date; Life Areas and Goals have no planning dates.
- Renamed the user-facing Scheduled date to Planned day and limited it to one-time Tasks and Subtasks.
- Changed the predefined Weekdays schedule to Sunday–Thursday.
- Made Every day, Sunday–Thursday, and Selected weekdays generate the current week's occurrences automatically.
- Added a simple recurrence end choice: Until I stop it or On a date.
- Added a direct Stop repeating action that preserves existing occurrences as normal Markdown notes.
- Added an Anytime or Specific time choice; fixed times work for one-time and recurring work.
- Kept flexible Times per week scheduling and Every week/Every month options while reducing conditional fields in the editor.
- Preserved legacy recurring series without duplicating their existing occurrence date.

## 0.10.0

- Added optional start/end times and planned duration to Tasks and Subtasks, including recurring occurrences.
- Added a normal count-up timer and manual time logging beside Pomodoro; completion never depends on any timer.
- Added planned-versus-actual time and source labels to Review while preserving full parent attribution.
- Added safe direct deletion from item menus, including descendants and an optional full recurring series; files move to Obsidian trash.
- Removed the Cancelled column from Kanban and excluded cancelled work from boards.
- Added Kanban settings for the default period, default item view, completed and unscheduled work, parent paths, severity, dates, and time details.
- Added time-aware Calendar sorting and readable meeting times across Calendar, Tree, Today, and Kanban.
- Kept every item title connected directly to its Markdown note for simple note viewing and editing.

## 0.9.0

- Made Severity the single progress roll-up model for Areas, Goals, Projects, Tasks, and Subtasks.
- Removed the Progress calculation selector and the default progress-calculation setting.
- Removed Manual progress, Current metric, Target metric, Metric unit, and Total focus estimate from Create/Edit dialogs.
- Kept Weekly focus target as the only time-allocation field; focused time remains separate from completion progress.
- Added automatic cleanup for legacy progress-mode and metric properties while preserving completion status and historical focused time.
- Fixed conditional recurrence fields so hidden options no longer occupy space.
- Rebuilt the weekday selector as compact, aligned checkbox chips instead of stretched controls.

## 0.8.0

- Added **Specific weekdays** recurrence with any Sunday–Saturday combination, including Sunday–Thursday schedules.
- Added flexible **Weekly target** recurrence for work such as one or two gym sessions per week.
- Generated only the current week's required occurrences while preserving every completed occurrence as a Markdown note.
- Added recurrence series start/end dates, allowed weekdays, weekly target counts, stable occurrence keys, and duplicate prevention.
- Added current-week completion badges to flexible weekly-target Kanban cards.
- Added Kanban display controls for Project › Task › Subtask hierarchy, Projects only, Tasks only, or Subtasks only.
- Added the same hierarchy and type controls to Completed Work.
- Made completed Project/Task/Subtask hierarchy visually nested and consistently archiveable.
- Kept Projects as automatic, read-only roll-ups even when the Kanban is filtered to Projects only.
- Preserved compatibility with existing Daily, Monday–Friday Weekdays, Weekly, and Monthly recurrence notes.

## 0.7.0

- Rebuilt Kanban around actionable leaf Tasks and Subtasks so automatic parent Tasks are no longer duplicated as work cards.
- Added collapsible parent Task groups with automatic status, progress, remaining-action count, cumulative focused time, and full strategic context.
- Added connector branches and recursive indentation for Subtasks nested to any depth.
- Kept each leaf action in its correct status column when sibling Subtasks have different statuses.
- Limited Today summaries, Today sections, Overview action lists, and Pomodoro selection to actionable leaf work.
- Preserved standalone Tasks as normal draggable Kanban cards.
- Made Kanban search include leaf actions when the search matches one of their parents.

## 0.6.0

- Made Life Areas permanent contexts that always remain Ongoing and cannot be completed, cancelled, or overdue themselves.
- Removed Start, Scheduled, and Due dates from Life Areas and automatically cleans legacy Area planning fields.
- Limited Scheduled dates to Tasks and Subtasks; Goals and Projects retain optional Start and Due dates.
- Excluded Life Areas from Calendar and all execution views while preserving descendant focus-time roll-up.
- Changed Area progress to the equal average of current direct Goals, with a clear No active goals state.
- Simplified the Area editor to identity and time-allocation fields instead of task-oriented controls.
- Added Current goals progress to the Overview summary.

## 0.5.1

- Removed the unintended horizontal scrollbar from Create and Edit dialogs.
- Applied the wide layout to the modal container instead of its inner content.
- Added responsive sizing constraints so dialog fields remain inside the visible window.

## 0.5.0

- Added Overview, Today, Tree, Calendar, Kanban, Focus, and Review workflows.
- Separated Start, Scheduled, and Due dates so availability, intention, and deadlines have distinct meanings.
- Added a Today dashboard for scheduled, overdue, active, available, unscheduled, and completed work.
- Added full item editing, type conversion with hierarchy validation, duplication, drag-to-reparent, and property repair.
- Added permanent `goal-id` and `goal-parent-id` properties so focus history survives file moves and title changes.
- Added Equal Children, Severity-Based, Manual, Target Metric, and Focused Time progress modes.
- Clarified Severity as urgency or consequence rather than a mandatory progress weight.
- Added daily, weekday, weekly, and monthly recurring Tasks and Subtasks; completing one creates the next occurrence.
- Added a detailed focus-session ledger with active, paused, completed, and interrupted sessions.
- Recorded actual focused duration and attributed every session to its work item and captured Project, Goal, and Life Area path.
- Added Review period filters for Today, Week, Month, Quarter, Year, All Time, and custom date ranges.
- Added weekly focus targets, scaled target-versus-actual allocation reporting, and session-level history.
- Added completed-work period and type filters plus archive, restore, and reopen actions.
- Preserved legacy date behavior in Kanban and migrated existing weight, milestone, daily-task, and path-based timer data.

## 0.4.0

- Replaced numeric impact weight with Low, Medium, High, and Critical severity.
- Added migration from legacy `goal-weight` values to `goal-severity`.
- Added strict parent filtering and validation based on the selected item type.
- Added automatic repair for non-work item types accidentally created under Tasks or Subtasks.
- Added a Completed view that keeps finished Tasks and Subtasks visible and reopenable.
- Added cumulative Pomodoro dashboards for Life Areas, Goals, Projects, Tasks, and Subtasks.
- Added Pomodoro session-count roll-ups alongside focused-time roll-ups.
- Added full ancestor paths to the Focus selector and Today's Focus list.
- Added Monthly, Quarterly, and Yearly Kanban scopes.

## 0.3.0

- Changed the planning hierarchy to Life Area, Goal, Project, Task, and Subtask.
- Added optional start dates to items, Calendar, and Kanban scheduling.
- Added Daily and Weekly Kanban scopes with period navigation.
- Restricted Pomodoro focus sessions to tasks and subtasks.
- Added focused-time roll-up through project, goal, and life-area ancestors.
- Set Muhammad Tahoun as the plugin author.
- Added automatic migration for legacy type names.

## 0.2.0

- Added Tree, Calendar, Kanban, and Focus view tabs.
- Added a persistent Pomodoro timer with configurable focus, short-break, and long-break intervals.
- Added Pomodoro counts and focused minutes to the selected goal note.
- Added drag-and-drop task status changes in Kanban.
- Added physical vault folder hierarchy for newly created child goals.
- Added a safe command to organize existing goal files into the same hierarchy.
- Added configurable calendar week start day.
- Simplified the empty-state starter description.

## 0.1.0

- Initial dashboard for nested life areas, goals, milestones, tasks, and daily tasks.
- Weighted progress roll-up through unlimited hierarchy depth.
- Deadline health propagation with on-time and late completion states.
- Markdown-native storage and optional calculated-property synchronization.
- Starter tree based on Religion, Family, Self Development, Work, and Finance.
