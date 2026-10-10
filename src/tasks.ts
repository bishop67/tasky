import { App, TFile, normalizePath } from "obsidian";
import { moment } from "./moment";

export type Status = "open" | "in-progress" | "done";

export const STATUSES: { value: Status; label: string; icon: string }[] = [
  { value: "open", label: "Open", icon: "circle" },
  { value: "in-progress", label: "In progress", icon: "circle-dot" },
  { value: "done", label: "Done", icon: "circle-check" },
];

export const PRIORITIES = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export const TASK_TAG = "task";
// Obsidian tags are case-insensitive, like Bases' file.hasTag().
export const isTaskTag = (tag: string) => tag.toLowerCase() === TASK_TAG;

export interface Draft {
  title: string;
  status: Status;
  priority?: string;
  due?: string;
  scheduled?: string;
  contexts: string[];
  tags: string[];
}

export interface Task extends Draft {
  file: TFile;
  pomodoros: number;
}

// Frontmatter values are whatever the YAML says; only strings and numbers count as text.
const toText = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

const toList = (value: unknown): string[] => {
  const items: unknown[] = Array.isArray(value) ? value : toText(value).split(",");
  return items.map((v) => toText(v).trim().replace(/^[#@]/, "")).filter(Boolean);
};

const toDate = (value: unknown) => toText(value) || undefined;

export function nextStatus(status: Status): Status {
  const i = STATUSES.findIndex((s) => s.value === status);
  return STATUSES[(i + 1) % STATUSES.length].value;
}

export function readTask(app: App, file: TFile): Task | null {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm) return null;
  const tags = toList(fm.tags);
  if (!tags.some(isTaskTag)) return null;
  const status = STATUSES.find((s) => s.value === fm.status)?.value ?? "open";
  return {
    file,
    title: file.basename,
    status,
    priority: PRIORITIES.find((p) => p.value === fm.priority)?.value,
    due: toDate(fm.due),
    scheduled: toDate(fm.scheduled),
    contexts: toList(fm.contexts),
    tags,
    pomodoros: Number(fm.pomodoros) || 0,
  };
}

export function allTasks(app: App): Task[] {
  return app.vault
    .getMarkdownFiles()
    .map((f) => readTask(app, f))
    .filter((t): t is Task => t !== null);
}

// A null value removes the property.
export async function updateTask(app: App, file: TFile, patch: Record<string, unknown>) {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || (Array.isArray(value) && !value.length)) delete fm[key];
      else fm[key] = value;
    }
  });
}

const completedDate = (status: Status) => (status === "done" ? moment().format("YYYY-MM-DD") : null);

// Setting the status a task already has is a no-op, so a done task keeps its completion date.
export async function setStatus(app: App, file: TFile, status: Status) {
  if (app.metadataCache.getFileCache(file)?.frontmatter?.status === status) return;
  await updateTask(app, file, { status, completedDate: completedDate(status) });
}

const safeName = (title: string) =>
  title.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled task";

export async function createTask(app: App, folder: string, draft: Draft): Promise<TFile> {
  const dir = normalizePath(folder);
  if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
  const name = safeName(draft.title);
  let path = `${dir}/${name}.md`;
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = `${dir}/${name} ${n}.md`;

  const file = await app.vault.create(path, "");
  const { status, priority, due, scheduled, contexts } = draft;
  await updateTask(app, file, {
    status,
    priority,
    due,
    scheduled,
    contexts,
    tags: [TASK_TAG, ...draft.tags.filter((t) => !isTaskTag(t))],
    completedDate: completedDate(draft.status),
  });
  return file;
}

// Dates are stored as YYYY-MM-DD, or YYYY-MM-DDTHH:mm when they have a time.
export function formatDate(value: string): string {
  const m = moment(value);
  if (!m.isValid()) return value;
  const day = m.year() === moment().year() ? m.format("MMM D") : m.format("MMM D, YYYY");
  return value.length > 10 ? `${day} ${m.format("HH:mm")}` : day;
}

export function dayRelation(value: string): "past" | "today" | "future" {
  const day = moment(value).format("YYYY-MM-DD");
  const today = moment().format("YYYY-MM-DD");
  return day < today ? "past" : day === today ? "today" : "future";
}
