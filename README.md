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
| Tree | Full hierarchy with progress, severity, health, notes, and direct actions |
| Graph | Responsive force-directed connections with animated motion, dragging, Area/status/depth filters, zoom, and pan |
| Calendar | Month, Week, and Day planning with Anytime, timed, Due, and unscheduled work |
| Kanban | Daily, Weekly, Monthly, Quarterly, and Yearly execution boards |
| Lists | Movies, books, courses, certifications, articles, and custom lists |
| Review | Completed work, habits, overdue and at-risk work, and Area summaries |

## Habits and repeating work

A habit is a Task or Subtask with **Repeating task** enabled, so the hierarchy stays simple. Repeat choices include every day, Sunday–Thursday, selected weekdays, a flexible number of times per week, every week, and every month. Preferred-day chips run from Sunday through Saturday. A repeat can continue until manually stopped or until a selected date.

Each occurrence has its own completion status. Review shows completed versus expected habit occurrences.

## Meetings and scheduling

Mark any Task or Subtask as a Meeting. It remains under its Project and can have a planned day, start time, end time, duration, notes, severity, and status.

Calendar Week is the default planning view and starts on Sunday. Work may be scheduled for Anytime or a specific time. Due dates remain visually separate from planned work. Unscheduled Tasks and Subtasks can be dragged to a day on desktop or tablet; on a phone, open the item and choose its planned day.

## Lists

New installations include Movies, Technical Books, Books, Courses, Certifications, and Articles. You can create more lists.

A list item can remain a simple reference or be promoted to a Goal, Project, Task, or Subtask. Completion is synchronized in both directions. Finished items remain visible below unfinished items and are crossed out with their completion date.

Reorder entries with the grip handle: drag it on desktop or long-press and drag it on mobile and tablet. The item menu also provides Move up and Move down. Active and finished entries have independent manual ordering, and finished entries always remain below active entries.

## Status, progress, and health

Leaf Tasks and Subtasks contribute 0% until completed, then 100%. Parent progress is the severity-weighted average of its active direct children. Cancelled work is excluded and hidden from Kanban.

An open item becomes At Risk when it is at least 20 percentage points behind its expected date progress, or when an open descendant is overdue. Areas remain neutral.

## Mobile and tablet

The plugin is not desktop-only and is designed for Obsidian mobile and tablet:

- touch-sized primary controls;
- horizontally scrollable tabs and weekly boards;
- stacked Lists, Calendar, and Review layouts;
- responsive create/edit dialogs;
- touch pan and zoom in Graph;
- Day Calendar for narrow screens.

For the simplest phone workflow, use Today, Day Calendar, Lists, and Review. Use tablet or desktop for the full weekly board and large graph.

## Markdown storage

Goal Tree items are normal Markdown notes inside the configured Goal Tree folder. Each note receives a permanent `goal-id`, readable parent link, type, status, severity, dates, recurrence fields, and calculated roll-up properties. Click an item title to open and edit its note body.

Deleting an item from Goal Tree moves its note and descendants to Obsidian trash. Completed work remains visible until you archive it. Personal Lists are stored in the plugin's local Obsidian data.

## Installation

1. Extract the install ZIP.
2. Copy the extracted `goal-tree` folder into `<your-vault>/.obsidian/plugins/`.
3. Open **Settings → Community plugins**.
4. Reload installed plugins if needed, then enable **Goal Tree**.
5. Run **Goal Tree: Open overview** from the Command Palette or use its ribbon icon.

When upgrading, replace `main.js`, `manifest.json`, and `styles.css`, then reload Obsidian. Your Markdown notes and Lists remain intact.

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

- Goal Tree folder
- Default severity
- Calculated-property synchronization
- Today availability behavior
- First day of week
- Kanban period, item level, and visible card details

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
