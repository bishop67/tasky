import { Keymap, Menu, TFile, setIcon, setTooltip } from "obsidian";
import { moment } from "./moment";
import type Tasky from "./main";
import { PRIORITIES, STATUSES, Task, dayRelation, formatDate, nextStatus, setStatus, updateTask } from "./tasks";

export const DRAG_TYPE = "text/tasky-task";

// A card can be drawn for a task that isn't saved yet (the quick-add preview); it then has no file.
export type CardTask = Omit<Task, "file"> & { file: TFile | null };

export interface CardOptions {
  // Preview cards in the create modal don't react to clicks.
  interactive?: boolean;
  draggable?: boolean;
}

// Opens the native date picker next to the pointer and resolves with YYYY-MM-DD, or null if dismissed.
export function pickDate(evt: MouseEvent | null, initial?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.body.createEl("input", { type: "date", cls: "tasky-date-input" });
    input.value = initial ? moment(initial).format("YYYY-MM-DD") : "";
    input.style.left = `${evt?.clientX ?? window.innerWidth / 2}px`;
    input.style.top = `${evt?.clientY ?? window.innerHeight / 2}px`;
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => finish(input.value || null));
    input.addEventListener("blur", () => window.setTimeout(() => finish(null), 200));
    input.focus();
    try {
      input.showPicker();
    } catch {
      // showPicker needs a user gesture; the focused input is still usable.
    }
  });
}

// Keeps the time part of a date when the day changes.
export const withDay = (day: string, previous?: string) => (previous && previous.length > 10 ? `${day}${previous.slice(10)}` : day);

export function taskMenu(plugin: Tasky, task: Task, evt: MouseEvent) {
  const { app } = plugin;
  const menu = new Menu();

  for (const s of STATUSES) {
    menu.addItem((item) =>
      item
        .setSection("status")
        .setTitle(s.label)
        .setIcon(s.icon)
        .setChecked(task.status === s.value)
        .onClick(() => setStatus(app, task.file, s.value))
    );
  }
  for (const p of PRIORITIES) {
    menu.addItem((item) =>
      item
        .setSection("priority")
        .setTitle(`${p.label} priority`)
        .setIcon("flag")
        .setChecked(task.priority === p.value)
        .onClick(() => updateTask(app, task.file, { priority: task.priority === p.value ? null : p.value }))
    );
  }

  for (const [key, label] of [["due", "Due date"], ["scheduled", "Scheduled date"]] as const) {
    menu.addItem((item) =>
      item
        .setSection("dates")
        .setTitle(task[key] ? `${label}: ${formatDate(task[key])}` : `Set ${label.toLowerCase()}…`)
        .setIcon(key === "due" ? "calendar" : "calendar-clock")
        .onClick(async () => {
          const day = await pickDate(evt, task[key]);
          if (day) await updateTask(app, task.file, { [key]: withDay(day, task[key]) });
        })
    );
    if (task[key]) {
      menu.addItem((item) =>
        item
          .setSection("dates")
          .setTitle(`Clear ${label.toLowerCase()}`)
          .setIcon("calendar-x")
          .onClick(() => updateTask(app, task.file, { [key]: null }))
      );
    }
  }

  menu.addItem((item) =>
    item
      .setSection("actions")
      .setTitle("Focus on this task")
      .setIcon("timer")
      .onClick(() => plugin.pomodoro.focusOn(task.file))
  );
  menu.addItem((item) =>
    item
      .setSection("actions")
      .setTitle("Open in new tab")
      .setIcon("file-plus")
      .onClick(() => app.workspace.getLeaf("tab").openFile(task.file))
  );
  menu.addItem((item) =>
    item
      .setSection("danger")
      .setTitle("Delete task")
      .setIcon("trash-2")
      .setWarning(true)
      .onClick(() => app.fileManager.trashFile(task.file))
  );
  menu.showAtMouseEvent(evt);
}

export function priorityMenu(evt: MouseEvent, current: string | undefined, onPick: (priority?: string) => void) {
  const menu = new Menu();
  for (const p of PRIORITIES) {
    menu.addItem((item) => item.setTitle(p.label).setChecked(current === p.value).onClick(() => onPick(p.value)));
  }
  menu.addItem((item) => item.setTitle("None").setChecked(!current).onClick(() => onPick()));
  menu.showAtMouseEvent(evt);
}

export function renderGroup(parent: HTMLElement, plugin: Tasky, title: string | null, tasks: Task[], cls = "") {
  const section = parent.createDiv({ cls: `tasky-group ${cls}` });
  if (title !== null) {
    const heading = section.createDiv({ cls: "tasky-group__heading" });
    heading.createSpan({ text: title });
    heading.createSpan({ cls: "tasky-count", text: String(tasks.length) });
  }
  for (const task of tasks) renderTaskCard(section, plugin, task);
}

export function renderEmpty(parent: HTMLElement, text: string, onNew: () => void) {
  const empty = parent.createDiv({ cls: "tasky-empty" });
  empty.createDiv({ text });
  empty.createEl("button", { text: "New task" }).addEventListener("click", onNew);
}

export function dragSource(el: HTMLElement, payload: string) {
  el.draggable = true;
  el.addEventListener("dragstart", (evt) => {
    evt.dataTransfer?.setData(DRAG_TYPE, payload);
    el.addClass("is-dragging");
  });
  el.addEventListener("dragend", () => el.removeClass("is-dragging"));
}

function renderDate(meta: HTMLElement, label: string, value: string, kind: "due" | "scheduled", done: boolean) {
  const rel = dayRelation(value);
  const el = meta.createSpan({ cls: `tasky-card__date tasky-card__date--${kind}` });
  let text = `${label}: ${rel === "today" && value.length <= 10 ? "Today" : formatDate(value)}`;
  if (!done && rel === "past") text += kind === "due" ? " (overdue)" : " (past)";
  el.setText(text);
  if (!done) el.addClass(`is-${rel}`);
}

export function renderTaskCard(parent: HTMLElement, plugin: Tasky, task: CardTask, opts: CardOptions = {}) {
  const { app } = plugin;
  // Only saved tasks react to clicks.
  const saved: Task | null = (opts.interactive ?? true) && task.file ? { ...task, file: task.file } : null;
  const done = task.status === "done";

  const card = parent.createDiv({ cls: "tasky-card" });
  card.dataset.path = task.file?.path ?? "";
  card.toggleClass("is-done", done);
  card.toggleClass("is-focused", !!task.file && plugin.pomodoro.state.taskPath === task.file.path);
  card.toggleClass("is-interactive", !!saved);

  const status = card.createDiv({ cls: `tasky-card__status tasky-status--${task.status}` });
  if (saved) {
    const next = STATUSES.find((s) => s.value === nextStatus(task.status))!;
    setTooltip(status, `Mark ${next.label.toLowerCase()}`);
    status.addEventListener("click", (evt) => {
      evt.stopPropagation();
      void setStatus(app, saved.file, next.value);
    });
  }

  const body = card.createDiv({ cls: "tasky-card__body" });
  const titleRow = body.createDiv({ cls: "tasky-card__title" });
  if (task.priority) {
    const dot = titleRow.createSpan({ cls: `tasky-card__priority tasky-priority--${task.priority}` });
    if (saved) {
      setTooltip(dot, `${PRIORITIES.find((p) => p.value === task.priority)!.label} priority`);
      dot.addEventListener("click", (evt) => {
        evt.stopPropagation();
        priorityMenu(evt, saved.priority, (p) => void updateTask(app, saved.file, { priority: p ?? null }));
      });
    }
  }
  titleRow.createSpan({ cls: "tasky-card__title-text", text: task.title || "Untitled task" });

  const meta = body.createDiv({ cls: "tasky-card__meta" });
  if (task.due) renderDate(meta, "Due", task.due, "due", done);
  if (task.scheduled) renderDate(meta, "Scheduled", task.scheduled, "scheduled", done);
  for (const ctx of task.contexts) meta.createSpan({ cls: "tasky-card__context", text: `@${ctx}` });
  for (const tag of task.tags.filter((t) => t !== "task")) meta.createEl("a", { cls: "tag", text: `#${tag}` });
  if (task.pomodoros) {
    const pomos = meta.createSpan({ cls: "tasky-card__pomos" });
    setIcon(pomos.createSpan(), "timer");
    pomos.createSpan({ text: String(task.pomodoros) });
    setTooltip(pomos, `${task.pomodoros} pomodoro${task.pomodoros === 1 ? "" : "s"}`);
  }
  if (!meta.childElementCount) meta.remove();

  if (!saved) return card;

  const actions = card.createDiv({ cls: "tasky-card__actions" });
  const focus = actions.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Focus on this task" } });
  setIcon(focus, "timer");
  focus.addEventListener("click", (evt) => {
    evt.stopPropagation();
    plugin.pomodoro.focusOn(saved.file);
  });
  const more = actions.createDiv({ cls: "clickable-icon", attr: { "aria-label": "More" } });
  setIcon(more, "more-horizontal");
  more.addEventListener("click", (evt) => {
    evt.stopPropagation();
    taskMenu(plugin, saved, evt);
  });

  card.addEventListener("click", (evt) => {
    if ((evt.target as HTMLElement).closest("a.tag")) return;
    void app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(saved.file);
  });
  card.addEventListener("contextmenu", (evt) => {
    evt.preventDefault();
    taskMenu(plugin, saved, evt);
  });
  if (opts.draggable) dragSource(card, saved.file.path);
  return card;
}

