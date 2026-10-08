import { moment, setIcon } from "obsidian";
import type { Task } from "./tasks";

export type Moment = ReturnType<typeof moment>;

export const dayKey = (m: Moment) => m.format("YYYY-MM-DD");

// The days a task appears on: its due day and its scheduled day.
export function taskDays(task: Task): string[] {
  return [...new Set([task.due, task.scheduled].filter((d): d is string => !!d).map((d) => d.slice(0, 10)))];
}

export function tasksByDay(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    for (const day of taskDays(task)) {
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(task);
    }
  }
  return map;
}

export interface MonthOptions {
  month: Moment;
  compact?: boolean;
  onNavigate: (month: Moment) => void;
  renderDay: (cell: HTMLElement, day: Moment) => void;
}

// Weeks start on the locale's first day, so the grid matches Obsidian's language setting.
export function renderMonth(parent: HTMLElement, opts: MonthOptions) {
  const { month } = opts;
  const cal = parent.createDiv({ cls: "tasky-cal" });
  cal.toggleClass("is-compact", !!opts.compact);

  const header = cal.createDiv({ cls: "tasky-cal__header" });
  header.createDiv({ cls: "tasky-cal__title", text: month.format(opts.compact ? "MMM YYYY" : "MMMM YYYY") });
  const nav = header.createDiv({ cls: "tasky-cal__nav" });
  const button = (icon: string, label: string, target: () => Moment) => {
    const el = nav.createDiv({ cls: "clickable-icon", attr: { "aria-label": label } });
    setIcon(el, icon);
    el.addEventListener("click", () => opts.onNavigate(target()));
  };
  button("chevron-left", "Previous month", () => month.clone().subtract(1, "month"));
  const today = nav.createDiv({ cls: "tasky-cal__today", text: "Today" });
  today.addEventListener("click", () => opts.onNavigate(moment().startOf("month")));
  button("chevron-right", "Next month", () => month.clone().add(1, "month"));

  const grid = cal.createDiv({ cls: "tasky-cal__grid" });
  for (const name of opts.compact ? moment.weekdaysMin(true) : moment.weekdaysShort(true)) {
    grid.createDiv({ cls: "tasky-cal__weekday", text: name });
  }

  const todayKey = dayKey(moment());
  const end = month.clone().endOf("month").endOf("week");
  for (const day = month.clone().startOf("month").startOf("week"); day.isSameOrBefore(end, "day"); day.add(1, "day")) {
    const cell = grid.createDiv({ cls: "tasky-cal__day" });
    cell.dataset.day = dayKey(day);
    cell.toggleClass("is-outside", day.month() !== month.month());
    cell.toggleClass("is-today", dayKey(day) === todayKey);
    opts.renderDay(cell, day.clone());
  }
  return cal;
}
