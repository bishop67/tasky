import { BasesEntry, BasesView, Keymap, QueryController, setIcon, setTooltip } from "obsidian";
import type Tasky from "./main";
import { dayKey, renderMonth, tasksByDay } from "./calendar";
import { Moment, moment } from "./moment";
import { DRAG_TYPE, dragSource, renderEmpty, renderGroup, renderTaskCard, taskMenu, withDay } from "./card";
import { Draft, STATUSES, Task, formatDate, readTask, setStatus, updateTask } from "./tasks";

export const LIST_VIEW = "tasky-list";
export const BOARD_VIEW = "tasky-board";
export const CALENDAR_VIEW = "tasky-calendar";

abstract class TaskView extends BasesView {
  constructor(controller: QueryController, protected root: HTMLElement, protected plugin: Tasky) {
    super(controller);
    root.addClass("tasky-view");
    plugin.views.add(this);
  }

  onunload() {
    this.plugin.views.delete(this);
    this.root.empty();
  }

  onDataUpdated() {
    this.render();
  }

  abstract render(): void;

  // The toolbar's "New" button opens the quick-add modal instead of a blank note.
  async createFileForView() {
    this.plugin.openCreateModal();
  }

  protected tasks(entries: BasesEntry[]): Task[] {
    return entries.map((e) => readTask(this.app, e.file)).filter((t): t is Task => t !== null);
  }
}

// Highlights `el` while a task is dragged over it. `onDrop` gets the drag payload: the task path,
// then (from the calendar) a newline and the date field being moved.
function dropTarget(el: HTMLElement, onDrop: (path: string, field?: string) => void) {
  el.addEventListener("dragover", (evt) => {
    if (!evt.dataTransfer?.types.includes(DRAG_TYPE)) return;
    evt.preventDefault();
    el.addClass("is-drop-target");
  });
  el.addEventListener("dragleave", (evt) => {
    if (!el.contains(evt.relatedTarget as Node)) el.removeClass("is-drop-target");
  });
  el.addEventListener("drop", (evt) => {
    el.removeClass("is-drop-target");
    const payload = evt.dataTransfer?.getData(DRAG_TYPE);
    if (!payload) return;
    evt.preventDefault();
    const [path, field] = payload.split("\n");
    onDrop(path, field);
  });
}

export class TaskListView extends TaskView {
  type = LIST_VIEW;

  render() {
    this.root.empty();
    const list = this.root.createDiv({ cls: "tasky-list" });
    const groups = this.data.groupedData;
    const showHeadings = groups.length > 1 || groups.some((g) => g.hasKey());
    let count = 0;

    for (const group of groups) {
      const tasks = this.tasks(group.entries);
      if (!tasks.length) continue;
      count += tasks.length;
      renderGroup(list, this.plugin, showHeadings ? (group.hasKey() ? group.key!.toString() : "None") : null, tasks);
    }
    if (!count) renderEmpty(list, "Nothing here.", () => this.plugin.openCreateModal());
  }
}

// Columns are the three statuses; dragging a card between columns changes its status.
export class TaskBoardView extends TaskView {
  type = BOARD_VIEW;

  render() {
    const scroll = this.root.querySelector(".tasky-board")?.scrollLeft ?? 0;
    this.root.empty();
    const board = this.root.createDiv({ cls: "tasky-board" });
    const tasks = this.tasks(this.data.data);

    for (const status of STATUSES) {
      const inColumn = tasks.filter((t) => t.status === status.value);
      const column = board.createDiv({ cls: "tasky-column" });

      const header = column.createDiv({ cls: "tasky-column__header" });
      setIcon(header.createSpan({ cls: `tasky-column__icon tasky-status-text--${status.value}` }), status.icon);
      header.createSpan({ cls: "tasky-column__title", text: status.label });
      header.createSpan({ cls: "tasky-count", text: String(inColumn.length) });
      const add = header.createDiv({ cls: "clickable-icon tasky-column__add", attr: { "aria-label": `New ${status.label.toLowerCase()} task` } });
      setIcon(add, "plus");
      add.addEventListener("click", () => this.plugin.openCreateModal({ status: status.value }));

      const cards = column.createDiv({ cls: "tasky-column__cards" });
      for (const task of inColumn) renderTaskCard(cards, this.plugin, task, { draggable: true });
      dropTarget(column, (path) => {
        const file = this.app.vault.getFileByPath(path);
        if (file) void setStatus(this.app, file, status.value);
      });
    }
    board.scrollLeft = scroll;
  }
}

const MAX_CHIPS = 4;
type DateField = keyof Pick<Draft, "due" | "scheduled">;

// A month grid. Tasks sit on their due and scheduled days; drag one to another day to move that date.
export class TaskCalendarView extends TaskView {
  type = CALENDAR_VIEW;
  private month: Moment = moment().startOf("month");
  private expanded = new Set<string>();

  render() {
    this.root.empty();
    const days = tasksByDay(this.tasks(this.data.data));

    renderMonth(this.root, {
      month: this.month,
      onNavigate: (month) => {
        this.month = month;
        this.expanded.clear();
        this.render();
      },
      renderDay: (cell, day) => {
        const key = dayKey(day);
        const number = cell.createDiv({ cls: "tasky-cal__number", text: String(day.date()) });
        setTooltip(number, "New task on this day");
        number.addEventListener("click", () => this.plugin.openCreateModal({ due: key }));

        const onDay = days.get(key) ?? [];
        const shown = this.expanded.has(key) ? onDay : onDay.slice(0, MAX_CHIPS);
        for (const task of shown) this.chip(cell, task, key);
        if (onDay.length > shown.length) {
          const more = cell.createDiv({ cls: "tasky-cal__more", text: `+${onDay.length - shown.length} more` });
          more.addEventListener("click", () => {
            this.expanded.add(key);
            this.render();
          });
        }

        dropTarget(cell, (path, field) => {
          const file = this.app.vault.getFileByPath(path);
          const task = file && readTask(this.app, file);
          if (!task) return;
          // Cards dragged in from elsewhere carry no field; give them a due date.
          const target: DateField = field === "scheduled" ? "scheduled" : "due";
          void updateTask(this.app, task.file, { [target]: withDay(key, task[target]) });
        });
      },
    });
  }

  private chip(cell: HTMLElement, task: Task, key: string) {
    const chip = cell.createDiv({ cls: "tasky-chip" });
    chip.toggleClass("is-done", task.status === "done");
    chip.toggleClass("is-focused", this.plugin.pomodoro.state.taskPath === task.file.path);
    if (task.priority) chip.createSpan({ cls: `tasky-card__priority tasky-priority--${task.priority}` });
    chip.createSpan({ cls: "tasky-chip__title", text: task.title });
    // When both dates fall on this day, dragging moves the due date.
    const field: DateField = task.due?.startsWith(key) ? "due" : "scheduled";
    chip.toggleClass("is-scheduled", field === "scheduled");
    setTooltip(chip, `${task.title}\n${field === "due" ? "Due" : "Scheduled"} ${formatDate(task[field]!)}`);

    chip.addEventListener("click", (evt) => void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(task.file));
    chip.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      taskMenu(this.plugin, task, evt);
    });
    dragSource(chip, `${task.file.path}\n${field}`);
  }
}
