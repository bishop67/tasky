import { FuzzySuggestModal, Menu, Modal, Notice, setIcon, setTooltip } from "obsidian";
import type Tasky from "./main";
import { pickDate, renderTaskCard } from "./card";
import { parseQuickAdd } from "./parse";
import { Draft, PRIORITIES, STATUSES, Task, allTasks, createTask, formatDate } from "./tasks";

type Picked = Partial<Pick<Draft, "status" | "priority" | "due" | "scheduled">>;

// One line of text, parsed as you type, with buttons to set the same fields by hand.
// Anything picked with a button wins over what the text says.
export class CreateTaskModal extends Modal {
  private input!: HTMLTextAreaElement;
  private preview!: HTMLElement;
  private toolbar!: HTMLElement;
  private picked: Picked;

  constructor(private plugin: Tasky, defaults: Picked = {}) {
    super(plugin.app);
    this.picked = { ...defaults };
  }

  onOpen() {
    this.modalEl.addClass("tasky-create");
    this.setTitle("New task");

    this.input = this.contentEl.createEl("textarea", {
      cls: "tasky-create__input",
      attr: { rows: 2, placeholder: "Buy groceries tomorrow at 5pm @home #errands !high" },
    });
    this.input.addEventListener("input", () => this.refresh());
    this.input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.shiftKey && !evt.isComposing) {
        evt.preventDefault();
        void this.submit();
      }
    });

    this.toolbar = this.contentEl.createDiv({ cls: "tasky-create__toolbar" });
    this.preview = this.contentEl.createDiv({ cls: "tasky-create__preview" });
    this.contentEl.createDiv({
      cls: "tasky-create__hint",
      text: "Dates: today, tomorrow, fri, next week, in 3 days, oct 12 (add \"at 5pm\" for a time). Prefix with \"start\" or \"on\" for a scheduled date. @context  #tag  !high !normal !low",
    });

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { cls: "mod-cta", text: "Create" }).addEventListener("click", () => void this.submit());
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    this.refresh();
    window.setTimeout(() => this.input.focus(), 0);
  }

  private draft(): Draft {
    const parsed = parseQuickAdd(this.input.value);
    return {
      ...parsed,
      status: this.picked.status ?? "open",
      priority: this.picked.priority ?? parsed.priority,
      due: this.picked.due ?? parsed.due,
      scheduled: this.picked.scheduled ?? parsed.scheduled,
    };
  }

  private refresh() {
    const draft = this.draft();
    this.renderToolbar(draft);
    this.preview.empty();
    if (!draft.title) {
      this.preview.createDiv({ cls: "tasky-create__placeholder", text: "Preview shows here as you type." });
      return;
    }
    renderTaskCard(this.preview, this.plugin, { ...draft, file: null, pomodoros: 0 }, { interactive: false });
  }

  private tool(icon: string, label: string, set: boolean, onClick: (evt: MouseEvent) => void) {
    const btn = this.toolbar.createDiv({ cls: "clickable-icon tasky-create__tool" });
    btn.toggleClass("is-set", set);
    setIcon(btn, icon);
    setTooltip(btn, label);
    btn.addEventListener("click", onClick);
  }

  private renderToolbar(draft: Draft) {
    this.toolbar.empty();
    for (const [key, icon, label] of [
      ["due", "calendar", "Due date"],
      ["scheduled", "calendar-clock", "Scheduled date"],
    ] as const) {
      const value = draft[key];
      this.tool(icon, value ? `${label}: ${formatDate(value)}` : label, !!value, (evt) => {
        void pickDate(evt, value).then((day) => {
          if (day) this.picked[key] = day;
          this.refresh();
          this.input.focus();
        });
      });
    }

    this.tool("flag", draft.priority ? `Priority: ${draft.priority}` : "Priority", !!draft.priority, (evt) => {
      const menu = new Menu();
      for (const p of PRIORITIES) {
        menu.addItem((i) => i.setTitle(p.label).setChecked(draft.priority === p.value).onClick(() => this.pick({ priority: p.value })));
      }
      menu.addItem((i) => i.setTitle("None").setChecked(!draft.priority).onClick(() => this.pick({ priority: undefined })));
      menu.showAtMouseEvent(evt);
    });

    const status = STATUSES.find((s) => s.value === draft.status)!;
    this.tool(status.icon, `Status: ${status.label}`, draft.status !== "open", (evt) => {
      const menu = new Menu();
      for (const s of STATUSES) {
        menu.addItem((i) => i.setTitle(s.label).setIcon(s.icon).setChecked(draft.status === s.value).onClick(() => this.pick({ status: s.value })));
      }
      menu.showAtMouseEvent(evt);
    });

    if (Object.values(this.picked).some((v) => v !== undefined)) {
      this.tool("eraser", "Clear picked values", false, () => {
        this.picked = {};
        this.refresh();
      });
    }
  }

  private pick(patch: Picked) {
    Object.assign(this.picked, patch);
    // "None" priority has to beat a "!high" in the text, so keep an explicit marker.
    if ("priority" in patch && patch.priority === undefined) this.picked.priority = "";
    this.refresh();
    this.input.focus();
  }

  private async submit() {
    const draft = this.draft();
    if (!draft.title) {
      new Notice("Give the task a name first.");
      return;
    }
    if (!draft.priority) delete draft.priority;
    this.close();
    const file = await createTask(this.app, this.plugin.settings.tasksFolder, draft);
    new Notice(`Created “${file.basename}”`);
  }
}

export class TaskPickerModal extends FuzzySuggestModal<Task> {
  constructor(private plugin: Tasky, private onPick: (task: Task) => void) {
    super(plugin.app);
    this.setPlaceholder("Pick a task to focus on");
  }

  getItems() {
    return allTasks(this.app).filter((t) => t.status !== "done");
  }

  getItemText(task: Task) {
    return task.title;
  }

  onChooseItem(task: Task) {
    this.onPick(task);
  }
}
