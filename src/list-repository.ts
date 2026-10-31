import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  createDefaultLists,
  DEFAULT_LIST_TITLES,
  GoalList,
  listFileStem,
  parseGoalList,
  serializeGoalList
} from "./lists";

/**
 * Stores personal lists as ordinary Markdown notes inside the vault. Plugin
 * settings may be removed during an uninstall; vault notes are not.
 */
export class GoalListRepository {
  private readonly pathsById = new Map<string, string>();

  constructor(
    private readonly app: App,
    private readonly goalsFolder: () => string
  ) {}

  async load(legacyLists?: GoalList[]): Promise<GoalList[]> {
    const folderPath = this.folderPath();
    const folderExisted = this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder;
    const files = this.listFiles(folderPath);
    const lists: GoalList[] = [];
    this.pathsById.clear();

    for (const file of files) {
      const parsed = parseGoalList(await this.app.vault.read(file), file.basename);
      if (!parsed || this.pathsById.has(parsed.id)) continue;
      lists.push(parsed);
      this.pathsById.set(parsed.id, file.path);
    }

    if (lists.length > 0) return sortLists(lists);

    // An upgrade from 0.13.1 receives the old plugin-local data once and turns
    // it into vault Markdown. An existing empty folder means the user chose to
    // have no lists, so starter lists are not recreated.
    if (legacyLists !== undefined) {
      await this.sync(legacyLists);
      return cloneLists(legacyLists);
    }
    if (folderExisted) return [];

    const starters = createDefaultLists();
    await this.sync(starters);
    return cloneLists(starters);
  }

  async sync(lists: GoalList[]): Promise<void> {
    await this.ensureFolder(this.folderPath());
    const wantedIds = new Set(lists.map((list) => list.id));

    // Remove only files managed by Goal Tree. Other notes in the Lists folder
    // always remain untouched.
    for (const file of this.listFiles(this.folderPath())) {
      const parsed = parseGoalList(await this.app.vault.read(file), file.basename);
      if (!parsed) continue;
      this.pathsById.set(parsed.id, file.path);
      if (!wantedIds.has(parsed.id)) {
        await this.app.fileManager.trashFile(file);
        this.pathsById.delete(parsed.id);
      }
    }

    for (const list of lists) await this.write(list);
  }

  private async write(list: GoalList): Promise<void> {
    const currentPath = this.pathsById.get(list.id);
    const current = currentPath ? this.app.vault.getAbstractFileByPath(currentPath) : undefined;
    const content = serializeGoalList(list);
    if (current instanceof TFile) {
      if (await this.app.vault.read(current) !== content) await this.app.vault.modify(current, content);
      return;
    }

    const path = this.uniquePath(listFileStem(list.title));
    await this.app.vault.create(path, content);
    this.pathsById.set(list.id, path);
  }

  private listFiles(folderPath: string): TFile[] {
    return this.app.vault.getMarkdownFiles()
      .filter((file) => file.parent?.path === folderPath)
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private folderPath(): string {
    const root = normalizePath(this.goalsFolder().trim() || "Goal Tree");
    return normalizePath(`${root}/Lists`);
  }

  private uniquePath(title: string): string {
    const folder = this.folderPath();
    let index = 1;
    while (true) {
      const suffix = index === 1 ? "" : ` ${index}`;
      const path = normalizePath(`${folder}/${title}${suffix}.md`);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
      index += 1;
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = normalizePath(current ? `${current}/${part}` : part);
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`Cannot create the Lists folder because “${current}” is a file.`);
      await this.app.vault.createFolder(current);
    }
  }
}

function cloneLists(lists: GoalList[]): GoalList[] {
  return lists.map((list) => ({ ...list, items: list.items.map((item) => ({ ...item })) }));
}

function sortLists(lists: GoalList[]): GoalList[] {
  const starterOrder = new Map<string, number>(DEFAULT_LIST_TITLES.map((title, order) => [title, order]));
  const effectiveOrder = (list: GoalList): number => list.order < Number.MAX_SAFE_INTEGER
    ? list.order
    : (starterOrder.get(list.title) ?? Number.MAX_SAFE_INTEGER);
  return [...lists]
    .sort((left, right) => effectiveOrder(left) - effectiveOrder(right) || left.createdAt.localeCompare(right.createdAt) || left.title.localeCompare(right.title))
    .map((list, order) => ({ ...list, order }));
}
