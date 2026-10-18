import { FuzzySuggestModal, Menu, Modal, Notice, TFile, setIcon, setTooltip } from "obsidian";
import type Tasky from "./main";
import { pickDate, priorityMenu, renderTaskCard } from "./card";
import { moment } from "./moment";
import { parseQuickAdd } from "./parse";
import { Draft, STATUSES, Task, allTasks, createTask, formatDate } from "./tasks";

type Picked = Partial<Pick<Draft, "status" | "priority" | "due" | "scheduled">>;

// One line of text, parsed as you type, with buttons to set the same fields by hand.
// Anything picked with a button wins over what the text says.
// With no date in the text or picked, the task is due today, if that setting is on.
export class CreateTaskModal extends Modal {
  private input!: HTMLTextAreaElement;
  private preview!: HTMLElement;
  private toolbar!: HTMLElement;
  private picked: Picked;
  private fallbackDue?: string;

  constructor(private plugin: Tasky, defaults: Picked = {}) {
    super(plugin.app);
    this.picked = { ...defaults };
    if (plugin.settings.dueToday) this.fallbackDue = moment().format("YYYY-MM-DD");
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
      // "start fri" alone means the task isn't due yet.
      due: this.picked.due ?? parsed.due ?? (parsed.scheduled ? undefined : this.fallbackDue),
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

    this.tool("flag", draft.priority ? `Priority: ${draft.priority}` : "Priority", !!draft.priority, (evt) =>
      priorityMenu(evt, draft.priority, (priority) => this.pick({ priority }))
    );

    const status = STATUSES.find((s) => s.value === draft.status)!;
    this.tool(status.icon, `Status: ${status.label}`, draft.status !== "open", (evt) => {
      const menu = new Menu();
      for (const s of STATUSES) {
        menu.addItem((i) => i.setTitle(s.label).setIcon(s.icon).setChecked(draft.status === s.value).onClick(() => this.pick({ status: s.value })));
      }
      menu.showAtMouseEvent(evt);
    });

    const usingFallback = !!this.fallbackDue && draft.due === this.fallbackDue && !this.picked.due;
    if (usingFallback || Object.values(this.picked).some((v) => v !== undefined)) {
      this.tool("eraser", "Clear picked values", false, () => {
        this.picked = {};
        this.fallbackDue = undefined;
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

// Pick an open task, or type a new one and press Shift+Enter (or click the preview) to create and pick it, like TaskNotes.
export class TaskPickerModal extends FuzzySuggestModal<Task> {
  private footer!: HTMLElement;
  private creating = false;

  constructor(private plugin: Tasky, private onPick: (file: TFile) => void) {
    super(plugin.app);
    this.setPlaceholder("Pick a task to focus on, or type a new one");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to pick" },
      { command: "⇧↵", purpose: "to create a new task" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  onOpen() {
    void super.onOpen();
    this.scope.register(["Shift"], "Enter", (evt) => {
      evt.preventDefault();
      void this.create();
      return false;
    });
    // Right under the results, above the key hints.
    this.footer = createDiv({ cls: "tasky-picker__create" });
    this.resultContainerEl.after(this.footer);
    this.footer.addEventListener("click", () => void this.create());
    this.inputEl.addEventListener("input", () => this.renderFooter());
    this.renderFooter();
  }

  // New tasks follow the same rules as the New task window, including due today.
  private draft(): Draft {
    const parsed = parseQuickAdd(this.inputEl.value);
    const due = parsed.due ?? (parsed.scheduled || !this.plugin.settings.dueToday ? undefined : moment().format("YYYY-MM-DD"));
    return { ...parsed, status: "open", due };
  }

  private renderFooter() {
    this.footer.empty();
    const draft = this.draft();
    this.footer.toggle(!!draft.title);
    if (!draft.title) return;
    setIcon(this.footer.createDiv({ cls: "tasky-picker__create-icon" }), "plus-circle");
    const body = this.footer.createDiv({ cls: "tasky-picker__create-body" });
    renderTaskCard(body, this.plugin, { ...draft, file: null, pomodoros: 0 }, { interactive: false });
    const hint = body.createDiv({ cls: "tasky-picker__create-hint" });
    hint.createSpan({ cls: "tasky-picker__key", text: "⇧↵" });
    hint.createSpan({ text: "Create task" });
  }

  private async create() {
    const draft = this.draft();
    if (!draft.title || this.creating) return;
    this.creating = true;
    if (!draft.priority) delete draft.priority;
    this.close();
    const file = await createTask(this.app, this.plugin.settings.tasksFolder, draft);
    new Notice(`Created “${file.basename}”`);
    this.onPick(file);
  }

  getItems() {
    return allTasks(this.app).filter((t) => t.status !== "done");
  }

  getItemText(task: Task) {
    return task.title;
  }

  onChooseItem(task: Task) {
    this.onPick(task.file);
  }
}
