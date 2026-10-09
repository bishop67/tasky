import { ItemView, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type Tasky from "./main";
import { dayKey, renderMonth, taskDays, tasksByDay } from "./calendar";
import { Moment, moment } from "./moment";
import { renderEmpty, renderGroup, renderTaskCard } from "./card";
import { Task, allTasks } from "./tasks";

export const TASKS_PANEL = "tasky-tasks";

const RANK: Record<string, number> = { high: 3, normal: 2, low: 1 };
const rank = (t: Task) => RANK[t.priority ?? ""] ?? 0;
// The earliest of a task's due and scheduled days.
const firstDay = (t: Task) => taskDays(t).sort()[0];

function byDateThenPriority(a: Task, b: Task) {
  const da = firstDay(a) ?? "9999";
  const db = firstDay(b) ?? "9999";
  return da === db ? rank(b) - rank(a) : da < db ? -1 : 1;
}

// A sidebar list made for narrow widths: a small month calendar, then open tasks by when they're due.
export class TasksPanel extends ItemView {
  private month: Moment = moment().startOf("month");
  private selected: string | null = null;
  private showCalendar = true;
  private renderedDay = dayKey(moment());

  constructor(leaf: WorkspaceLeaf, private plugin: Tasky) {
    super(leaf);
  }

  getViewType() {
    return TASKS_PANEL;
  }

  getDisplayText() {
    return "Tasks";
  }

  getIcon() {
    return "list-checks";
  }

  async onOpen() {
    this.contentEl.addClass("tasky-panel");
    this.plugin.views.add(this);
    const refresh = debounce(() => this.render(), 250, true);
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    // Roll "Today" over at midnight.
    this.registerInterval(
      window.setInterval(() => {
        if (dayKey(moment()) !== this.renderedDay) this.render();
      }, 60_000)
    );
    this.render();
  }

  async onClose() {
    this.plugin.views.delete(this);
  }

  render() {
    const el = this.contentEl;
    const scroll = el.scrollTop;
    el.empty();
    this.renderedDay = dayKey(moment());
    const tasks = allTasks(this.app);
    const open = tasks.filter((t) => t.status !== "done");

    const toolbar = el.createDiv({ cls: "tasky-panel__toolbar" });
    toolbar.createDiv({ cls: "tasky-panel__summary", text: `${open.length} open` });
    const icon = (name: string, label: string, onClick: () => void, active = false) => {
      const btn = toolbar.createDiv({ cls: "clickable-icon", attr: { "aria-label": label } });
      btn.toggleClass("is-active", active);
      setIcon(btn, name);
      btn.addEventListener("click", onClick);
    };
    icon("calendar-days", this.showCalendar ? "Hide calendar" : "Show calendar", () => {
      this.showCalendar = !this.showCalendar;
      if (!this.showCalendar) this.selected = null;
      this.render();
    }, this.showCalendar);
    icon("table", "Open task views", () => void this.plugin.openTaskBase());
    icon("plus", "New task", this.newTask);

    if (this.showCalendar) this.renderCalendar(el, open);

    const list = el.createDiv({ cls: "tasky-panel__list" });
    if (this.selected) this.renderDay(list, tasks);
    else this.renderUpcoming(list, open);
    el.scrollTop = scroll;
  }

  private renderCalendar(parent: HTMLElement, open: Task[]) {
    const days = tasksByDay(open);
    const today = dayKey(moment());
    renderMonth(parent, {
      month: this.month,
      compact: true,
      onNavigate: (month) => {
        this.month = month;
        this.render();
      },
      renderDay: (cell, day) => {
        const key = dayKey(day);
        cell.setText(String(day.date()));
        cell.toggleClass("is-selected", key === this.selected);
        const count = days.get(key)?.length ?? 0;
        if (count) {
          const dot = cell.createDiv({ cls: "tasky-cal__dot" });
          dot.toggleClass("is-overdue", key < today);
          cell.setAttr("aria-label", `${count} task${count === 1 ? "" : "s"}`);
        }
        cell.addEventListener("click", () => {
          this.selected = this.selected === key ? null : key;
          this.render();
        });
      },
    });
  }

  private renderUpcoming(list: HTMLElement, open: Task[]) {
    const today = dayKey(moment());
    const sorted = [...open].sort(byDateThenPriority);
    const groups: [string, (day?: string) => boolean][] = [
      ["Overdue", (d) => !!d && d < today],
      ["Today", (d) => d === today],
      ["Upcoming", (d) => !!d && d > today],
      ["No date", (d) => !d],
    ];
    for (const [title, test] of groups) {
      const tasks = sorted.filter((t) => test(firstDay(t)));
      if (tasks.length) renderGroup(list, this.plugin, title, tasks, title === "Overdue" ? "is-overdue" : "");
    }
    if (!open.length) renderEmpty(list, "All clear.", this.newTask);
  }

  private renderDay(list: HTMLElement, tasks: Task[]) {
    const key = this.selected!;
    const onDay = tasks
      .filter((t) => taskDays(t).includes(key))
      .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || rank(b) - rank(a));
    const heading = list.createDiv({ cls: "tasky-group__heading tasky-panel__day" });
    heading.createSpan({ text: moment(key).format("dddd, MMM D") });
    const clear = heading.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Show all tasks" } });
    setIcon(clear, "x");
    clear.addEventListener("click", () => {
      this.selected = null;
      this.render();
    });
    for (const task of onDay) renderTaskCard(list, this.plugin, task);
    if (!onDay.length) renderEmpty(list, "Nothing on this day.", this.newTask);
  }

  private newTask = () => this.plugin.openCreateModal(this.selected ? { due: this.selected } : {});
}
