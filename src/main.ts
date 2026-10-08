import { App, Notice, Plugin, PluginSettingTab, Setting, normalizePath } from "obsidian";
import { CreateTaskModal } from "./modals";
import { POMODORO_VIEW, Pomodoro, PomodoroState, PomodoroView, renderStatusBar } from "./pomodoro";
import { TASKS_PANEL, TasksPanel } from "./panel";
import { Draft } from "./tasks";
import { BOARD_VIEW, CALENDAR_VIEW, LIST_VIEW, TaskBoardView, TaskCalendarView, TaskListView } from "./views";

interface Settings {
  tasksFolder: string;
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
}

interface SavedData {
  settings?: Partial<Settings>;
  pomodoro?: Partial<PomodoroState>;
}

const DEFAULTS: Settings = {
  tasksFolder: "Tasks",
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
};

const BASE_FILE = `filters:
  and:
    - file.hasTag("task")
formulas:
  priorityRank: if(priority == "high", 3, if(priority == "normal", 2, if(priority == "low", 1, 0)))
views:
  - type: ${LIST_VIEW}
    name: Today
    filters:
      and:
        - status != "done"
        - or:
            - and:
                - due.isEmpty() == false
                - date(due) < today() + "1 day"
            - and:
                - scheduled.isEmpty() == false
                - date(scheduled) < today() + "1 day"
    sort:
      - property: formula.priorityRank
        direction: DESC
      - property: due
        direction: ASC
  - type: ${LIST_VIEW}
    name: All tasks
    filters:
      and:
        - status != "done"
    sort:
      - property: due
        direction: ASC
      - property: formula.priorityRank
        direction: DESC
  - type: ${BOARD_VIEW}
    name: Board
    sort:
      - property: formula.priorityRank
        direction: DESC
  - type: ${CALENDAR_VIEW}
    name: Calendar
  - type: ${LIST_VIEW}
    name: Done
    filters:
      and:
        - status == "done"
    sort:
      - property: completedDate
        direction: DESC
`;

export default class Tasky extends Plugin {
  settings: Settings = { ...DEFAULTS };
  pomodoro!: Pomodoro;
  // Everything that draws task cards, so they can redraw when the focused task changes.
  views = new Set<{ render(): void }>();

  async onload() {
    const data = ((await this.loadData()) ?? {}) as SavedData;
    this.settings = { ...DEFAULTS, ...data.settings };
    this.pomodoro = new Pomodoro(this, data.pomodoro);

    this.registerBasesView(LIST_VIEW, {
      name: "Task list",
      icon: "list-checks",
      factory: (controller, el) => new TaskListView(controller, el, this),
    });
    this.registerBasesView(BOARD_VIEW, {
      name: "Task board",
      icon: "square-kanban",
      factory: (controller, el) => new TaskBoardView(controller, el, this),
    });
    this.registerBasesView(CALENDAR_VIEW, {
      name: "Task calendar",
      icon: "calendar-days",
      factory: (controller, el) => new TaskCalendarView(controller, el, this),
    });
    this.registerView(POMODORO_VIEW, (leaf) => new PomodoroView(leaf, this));
    this.registerView(TASKS_PANEL, (leaf) => new TasksPanel(leaf, this));

    this.addRibbonIcon("list-checks", "Open tasks panel", () => this.activateSidebarView(TASKS_PANEL));
    this.addRibbonIcon("timer", "Open pomodoro", () => this.activatePomodoroView());

    this.addCommand({ id: "create-task", name: "New task", callback: () => this.openCreateModal() });
    this.addCommand({ id: "open-tasks-panel", name: "Open tasks panel", callback: () => this.activateSidebarView(TASKS_PANEL) });
    this.addCommand({ id: "open-tasks", name: "Open task views", callback: () => this.openTaskBase() });
    this.addCommand({ id: "open-pomodoro", name: "Open pomodoro", callback: () => this.activatePomodoroView() });
    this.addCommand({ id: "toggle-pomodoro", name: "Start or pause pomodoro", callback: () => this.pomodoro.toggle() });
    this.addCommand({ id: "stop-pomodoro", name: "Stop pomodoro", callback: () => this.pomodoro.stop() });

    const statusBar = this.addStatusBarItem();
    statusBar.addClass("tasky-statusbar", "mod-clickable");
    statusBar.addEventListener("click", () => void this.activatePomodoroView());
    const tick = () => {
      this.pomodoro.tick();
      renderStatusBar(statusBar, this);
    };
    this.registerInterval(window.setInterval(tick, 1000));
    // The focused task gets highlighted in every open view.
    this.registerEvent(this.pomodoro.on("change", () => this.views.forEach((v) => v.render())));
    tick();

    this.addSettingTab(new TaskySettingTab(this.app, this));
  }

  persist() {
    return this.saveData({ settings: this.settings, pomodoro: this.pomodoro.state });
  }

  openCreateModal(defaults: Partial<Pick<Draft, "status" | "due">> = {}) {
    new CreateTaskModal(this, defaults).open();
  }

  async openTaskBase() {
    const folder = normalizePath(this.settings.tasksFolder);
    const path = `${folder}/Tasks.base`;
    let file = this.app.vault.getFileByPath(path);
    if (!file) {
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      file = await this.app.vault.create(path, BASE_FILE);
      new Notice(`Created ${path}`);
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  activatePomodoroView() {
    return this.activateSidebarView(POMODORO_VIEW);
  }

  async activateSidebarView(type: string) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(type)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
}

class TaskySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: Tasky) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const { settings } = this.plugin;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Tasks folder")
      .setDesc("New tasks and the task views file are created in this folder.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULTS.tasksFolder)
          .setValue(settings.tasksFolder)
          .onChange(async (value) => {
            settings.tasksFolder = value.trim() || DEFAULTS.tasksFolder;
            await this.plugin.persist();
          })
      );

    new Setting(containerEl).setName("Pomodoro").setHeading();
    const minutes = (name: string, key: keyof Omit<Settings, "tasksFolder">, desc?: string) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc ?? "")
        .addText((text) => {
          text.inputEl.type = "number";
          text.inputEl.min = "1";
          text
            .setPlaceholder(String(DEFAULTS[key]))
            .setValue(String(settings[key]))
            .onChange(async (value) => {
              const n = Math.round(Number(value));
              if (!(n >= 1)) return;
              settings[key] = n;
              this.plugin.pomodoro.refreshDurations();
              await this.plugin.persist();
            });
        });
    minutes("Focus length", "workMinutes", "Minutes.");
    minutes("Short break", "shortBreakMinutes", "Minutes.");
    minutes("Long break", "longBreakMinutes", "Minutes.");
    minutes("Long break every", "longBreakEvery", "Number of focus sessions before a long break.");
  }
}
