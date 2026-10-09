import { App, Notice, Plugin, PluginSettingTab, SettingDefinitionItem, normalizePath } from "obsidian";
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

type MinuteKey = Exclude<keyof Settings, "tasksFolder">;

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

    for (const [type, name, icon, View] of [
      [LIST_VIEW, "Task list", "list-checks", TaskListView],
      [BOARD_VIEW, "Task board", "square-kanban", TaskBoardView],
      [CALENDAR_VIEW, "Task calendar", "calendar-days", TaskCalendarView],
    ] as const) {
      this.registerBasesView(type, { name, icon, factory: (controller, el) => new View(controller, el, this) });
    }
    this.registerView(POMODORO_VIEW, (leaf) => new PomodoroView(leaf, this));
    this.registerView(TASKS_PANEL, (leaf) => new TasksPanel(leaf, this));

    const openPanel = () => this.activateSidebarView(TASKS_PANEL);
    const openPomodoro = () => this.activateSidebarView(POMODORO_VIEW);
    this.addRibbonIcon("list-checks", "Open tasks panel", openPanel);
    this.addRibbonIcon("timer", "Open pomodoro", openPomodoro);

    for (const [id, name, callback] of [
      ["create-task", "New task", () => this.openCreateModal()],
      ["open-tasks-panel", "Open tasks panel", openPanel],
      ["open-tasks", "Open task views", () => this.openTaskBase()],
      ["open-pomodoro", "Open pomodoro", openPomodoro],
      ["toggle-pomodoro", "Start or pause pomodoro", () => this.pomodoro.toggle()],
      ["stop-pomodoro", "Stop pomodoro", () => this.pomodoro.stop()],
    ] as const) {
      this.addCommand({ id, name, callback });
    }

    const statusBar = this.addStatusBarItem();
    statusBar.addClass("tasky-statusbar", "mod-clickable");
    statusBar.addEventListener("click", () => void openPomodoro());
    const tick = () => {
      this.pomodoro.tick();
      renderStatusBar(statusBar, this);
    };
    this.registerInterval(window.setInterval(tick, 1000));
    // The focused task gets highlighted in every open view.
    this.registerEvent(this.pomodoro.on("change", () => this.views.forEach((v) => v.render())));
    // Keep focus on a task when it, or a folder it's in, is renamed or moved.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const path = this.pomodoro.state.taskPath;
        if (path === oldPath || path?.startsWith(oldPath + "/")) {
          this.pomodoro.setTask(file.path + path.slice(oldPath.length));
        }
      })
    );
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

  getSettingDefinitions(): SettingDefinitionItem[] {
    const minutes = (name: string, key: MinuteKey, desc = "Minutes.") =>
      ({ name, desc, control: { type: "number", key, min: 1, step: 1, placeholder: String(DEFAULTS[key]) } }) as const;
    return [
      {
        name: "Tasks folder",
        desc: "New tasks and the task views file are created in this folder.",
        control: { type: "folder", key: "tasksFolder", placeholder: DEFAULTS.tasksFolder },
      },
      {
        type: "group",
        heading: "Pomodoro",
        items: [
          minutes("Focus length", "workMinutes"),
          minutes("Short break", "shortBreakMinutes"),
          minutes("Long break", "longBreakMinutes"),
          minutes("Long break every", "longBreakEvery", "Number of focus sessions before a long break."),
        ],
      },
    ];
  }

  // The default writes plugin.settings as the whole data file, which would drop the pomodoro state.
  async setControlValue(key: string, value: unknown) {
    const { settings } = this.plugin;
    if (key === "tasksFolder") settings.tasksFolder = String(value).trim() || DEFAULTS.tasksFolder;
    else {
      const n = Math.round(Number(value));
      if (!(n >= 1)) return;
      settings[key as MinuteKey] = n;
      this.plugin.pomodoro.refreshDurations();
    }
    await this.plugin.persist();
  }
}
