# Goal Tree

Goal Tree is a local-first Obsidian plugin by Muhammad Tahoun for managing life Areas, Goals, Projects, Tasks, Subtasks, habits, meetings, and simple personal lists.

## Structure

```text
Area → Goal → Project → Task → Subtask
```

Areas are permanent contexts such as Work, Family, or Self Development. They have no dates, completion status, or risk color. Every other level rolls progress upward from its children using severity: Low, Medium, High, or Critical.

| Type | Allowed parent | Dates |
| --- | --- | --- |
| Area | None | None |
| Goal | Area or Goal | Start and optional Due |
| Project | Goal | Start and optional Due |
| Task | Project | Start, optional planned day/time, optional Due |
| Subtask | Task or Subtask | Start, optional planned day/time, optional Due |

## Views

| View | Purpose |
| --- | --- |
| Overview | Current goal progress, today totals, life balance, and attention summary |
| Today | Planned, overdue, active, available, unscheduled, and completed actions |
| Tree | Full hierarchy with progress, severity, health, notes, reparenting, and direct actions |
| Graph | Interactive left-to-right hierarchy with type columns, compact labeled nodes, smooth zoom, pan, pinch, and dragging |
| Calendar | Interactive Month, Week, and hourly Day planning with draggable All-day, timed, Due, and unscheduled work |
| Kanban | Daily, Weekly, Monthly, Quarterly, and Yearly boards with combinable Project/Task/Subtask filters |
| Lists | Movies, books, courses, certifications, articles, people, documentaries, podcasts, and custom lists |
| Review | Focused Needs attention and Completed work modes with type and period filters |

Selecting an item in any view opens the same inspector. On desktop and tablet it appears at the right; on phones it becomes a bottom sheet. The inspector shows context, progress, health explanation, dates, recurrence, status controls, inline notes, Edit, Open note, and Delete.

All eight views share the same compact icon-led header, control strips, spacing, status accents, row behavior, inspector, and responsive rules. The interface uses Obsidian theme variables, so light, dark, and custom themes remain visually consistent.

## Habits and repeating work

A habit is a Task or Subtask with **Repeating task** enabled, so the hierarchy stays simple. Repeat choices include every day, configured Workdays (Sunday–Thursday by default), selected weekdays, a flexible number of times per week, every week, and every month. Preferred-day chips run from Sunday through Saturday. A repeat can continue until manually stopped or until a selected date.

Each occurrence has its own completion status. Review shows completed versus expected habit occurrences.

## Meetings and scheduling

Mark any Task or Subtask as a Meeting. It remains under its Project and can have a planned day, start time, end time, notes, severity, and status.

Calendar supports Month, Week, and Day planning and starts weeks on Sunday by default. Work may be scheduled for Anytime or a specific time. Due dates remain visually separate from planned work. Both unscheduled work and existing scheduled events can be dragged to another day.

## Lists

New installations include Movies, Technical Books, Books, Courses, Certifications, Articles, People of Interest, Documentaries, and Podcasts. You can create more lists.

A list item can remain a simple reference or be promoted to a Goal, Project, Task, or Subtask. Completion is synchronized in both directions. Finished items remain visible below unfinished items and are crossed out with their completion date.

Reorder both list categories and entries with their grip handles on desktop. On mobile and tablet, use each item menu's Move up and Move down actions. Active and finished entries have independent manual ordering, and finished entries always remain below active entries.

Each list is a readable Markdown note in `Goal Tree/Lists`. Existing Lists from 0.13.1 are migrated automatically when upgrading, and reinstalling the plugin does not remove these notes.

## Status, progress, and health

Leaf Tasks and Subtasks contribute 0% until completed, then 100%. Parent progress is the severity-weighted average of its active direct children. Cancelled work is excluded and hidden from Kanban.

An open item becomes At Risk when it is at least 20 percentage points behind its expected date progress, or when an open descendant is overdue. Areas remain neutral.

## Mobile and tablet

The plugin is not desktop-only and is designed for Obsidian mobile and tablet:

- touch-sized primary controls;
- horizontally scrollable tabs and weekly boards;
- a shared item inspector that becomes a bottom sheet on phones;
- stacked Lists, Calendar, Review, and optional Kanban layouts;
- responsive create/edit dialogs;
- touch pan and zoom in Graph;
- Day Calendar for narrow screens.

For the simplest phone workflow, use Today, Day Calendar, Lists, and Review. Use tablet or desktop for the full weekly board and large graph.

## Markdown storage

Goal Tree items are normal Markdown notes inside the configured Goal Tree folder. Each note receives a permanent `goal-id`, readable parent link, type, status, severity, dates, recurrence fields, short notes, stable ordering, and calculated roll-up properties. Select an item to inspect or edit its short note, then choose **Open note** for the full Markdown body.

Deleting an item from Goal Tree moves its note and descendants to Obsidian trash. Completed work remains visible until you archive it. Personal Lists are stored as normal Markdown notes in `Goal Tree/Lists`.

## Installation

1. Open **Obsidian → Settings → Community plugins**.
2. Select **Browse** and search for **Goal Tree**.
3. Select **Install**, then **Enable**.
4. Open Goal Tree from the ribbon or run **Goal Tree: Open overview** from the Command Palette.

## Commands

- Goal Tree: Open overview
- Goal Tree: Open Today
- Goal Tree: Open goal hierarchy
- Goal Tree: Open graph
- Goal Tree: Open calendar
- Goal Tree: Open kanban
- Goal Tree: Open lists
- Goal Tree: Open Review
- Goal Tree: Create starter goal tree
- Goal Tree: Organize files into goal hierarchy
- Goal Tree: Repair goal properties and identities

## Settings

- **General:** Goal Tree folder, default view, interface density, and default severity.
- **Planning:** first day of week, workdays, time format, and Today availability.
- **Kanban:** default period, combined item types, parent grouping, visible details, completed ordering, and mobile layout.
- **Graph:** motion, label behavior, and spacing.
- **Lists:** finished-item ordering.
- **Data:** calculated-property synchronization and delete confirmation.

## Development

Requires Node.js 18 or newer.

```bash
npm install
npm run check
```

## Privacy

Goal Tree works locally inside your Obsidian vault. It makes no network requests and uses no analytics service.

## License

MIT
