import { Events, ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { moment } from "./moment";
import type Tasky from "./main";
import { renderTaskCard } from "./card";
import { readTask, updateTask } from "./tasks";
import { TaskPickerModal } from "./modals";

export const POMODORO_VIEW = "tasky-pomodoro";

export type Phase = "work" | "short" | "long";

export interface PomodoroState {
  phase: Phase;
  running: boolean;
  // While running, the timer is driven by endsAt so it survives sleep and reloads.
  endsAt: number | null;
  remaining: number;
  total: number;
  taskPath: string | null;
  sessions: number;
  today: { date: string; count: number };
}

const PHASE_LABEL: Record<Phase, string> = { work: "Focus", short: "Short break", long: "Long break" };

export const formatClock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function chime() {
  try {
    const ctx = new AudioContext();
    // Created outside a click, so it can start suspended.
    void ctx.resume();
    [0, 0.25].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.4);
    });
    window.setTimeout(() => void ctx.close(), 1000);
  } catch {
    // no audio available
  }
}

// The in-app notice stays until dismissed, and a system notification reaches you
// when Obsidian isn't the window in front. Clicking it brings the timer up.
function notify(plugin: Tasky, message: string) {
  new Notice(message, 0);
  if (typeof Notification === "undefined") return;
  const send = () => {
    const n = new Notification("Tasky", { body: message, requireInteraction: true });
    n.onclick = () => {
      window.focus();
      void plugin.activateSidebarView(POMODORO_VIEW);
      n.close();
    };
  };
  if (Notification.permission === "granted") send();
  else if (Notification.permission !== "denied") {
    void Notification.requestPermission().then((p) => p === "granted" && send());
  }
}

export class Pomodoro extends Events {
  state: PomodoroState;

  constructor(private plugin: Tasky, saved?: Partial<PomodoroState>) {
    super();
    const fresh = this.minutes("work");
    this.state = {
      phase: "work",
      running: false,
      endsAt: null,
      remaining: fresh,
      total: fresh,
      taskPath: null,
      sessions: 0,
      today: { date: moment().format("YYYY-MM-DD"), count: 0 },
      ...saved,
    };
  }

  private minutes(phase: Phase) {
    const s = this.plugin.settings;
    return (phase === "work" ? s.workMinutes : phase === "short" ? s.shortBreakMinutes : s.longBreakMinutes) * 60_000;
  }

  get remaining() {
    const { running, endsAt, remaining } = this.state;
    return running && endsAt ? Math.max(0, endsAt - Date.now()) : remaining;
  }

  // Untouched: a fresh focus session that hasn't started.
  get idle() {
    return !this.state.running && this.state.phase === "work" && this.state.remaining === this.state.total;
  }

  get completedToday() {
    return this.state.today.date === moment().format("YYYY-MM-DD") ? this.state.today.count : 0;
  }

  get task() {
    const file = this.state.taskPath ? this.plugin.app.vault.getFileByPath(this.state.taskPath) : null;
    return file ? readTask(this.plugin.app, file) : null;
  }

  private changed() {
    void this.plugin.persist();
    this.trigger("change");
  }

  start() {
    if (this.state.running) return;
    this.state.running = true;
    this.state.endsAt = Date.now() + this.state.remaining;
    this.changed();
  }

  pause() {
    if (!this.state.running) return;
    this.state.remaining = this.remaining;
    this.state.running = false;
    this.state.endsAt = null;
    this.changed();
  }

  toggle() {
    if (this.state.running) this.pause();
    else this.start();
  }

  stop() {
    this.enter("work", false);
  }

  // Applies new durations from settings to an untouched timer.
  refreshDurations() {
    if (this.idle) this.enter("work", false);
  }

  adjust(minutes: number) {
    const delta = minutes * 60_000;
    if (this.remaining + delta < 60_000) return;
    this.state.total = Math.max(60_000, this.state.total + delta);
    if (this.state.running && this.state.endsAt) this.state.endsAt += delta;
    else this.state.remaining += delta;
    this.changed();
  }

  setTask(file: TFile | string | null) {
    this.state.taskPath = typeof file === "string" ? file : (file?.path ?? null);
    this.changed();
  }

  // Picks the task, starts a focus session and shows the timer.
  focusOn(file: TFile) {
    this.state.taskPath = file.path;
    if (this.state.phase !== "work") this.enter("work", false);
    this.start();
    this.changed();
    void this.plugin.activateSidebarView(POMODORO_VIEW);
  }

  private enter(phase: Phase, running: boolean) {
    const ms = this.minutes(phase);
    this.state.phase = phase;
    this.state.total = ms;
    this.state.remaining = ms;
    this.state.running = running;
    this.state.endsAt = running ? Date.now() + ms : null;
    this.changed();
  }

  tick() {
    if (this.state.running && this.remaining <= 0) void this.complete();
  }

  private async complete() {
    chime();
    if (this.state.phase !== "work") {
      notify(this.plugin, "Break's over. Ready when you are.");
      this.enter("work", false);
      return;
    }
    const today = moment().format("YYYY-MM-DD");
    this.state.today = { date: today, count: this.completedToday + 1 };
    this.state.sessions++;
    const long = this.state.sessions % this.plugin.settings.longBreakEvery === 0;
    this.enter(long ? "long" : "short", true);
    notify(this.plugin, `Pomodoro done. Time for a ${long ? "long" : "short"} break.`);

    const task = this.task;
    if (task) await updateTask(this.plugin.app, task.file, { pomodoros: task.pomodoros + 1 });
  }

  phaseLabel() {
    if (this.idle) return "Ready to start";
    if (!this.state.running) return "Paused";
    return PHASE_LABEL[this.state.phase];
  }
}

const RADIUS = 92;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export class PomodoroView extends ItemView {
  private timeEl!: HTMLElement;
  private phaseEl!: HTMLElement;
  private arcEl!: SVGCircleElement;

  constructor(leaf: WorkspaceLeaf, private plugin: Tasky) {
    super(leaf);
  }

  getViewType() {
    return POMODORO_VIEW;
  }

  getDisplayText() {
    return "Pomodoro";
  }

  getIcon() {
    return "timer";
  }

  async onOpen() {
    this.contentEl.addClass("tasky-pomodoro");
    this.registerEvent(this.plugin.pomodoro.on("change", () => this.render()));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file.path === this.plugin.pomodoro.state.taskPath) this.render();
      })
    );
    this.registerInterval(window.setInterval(() => this.update(), 1000));
    this.render();
  }

  private render() {
    const p = this.plugin.pomodoro;
    const el = this.contentEl;
    el.empty();
    el.toggleClass("is-break", p.state.phase !== "work");
    el.toggleClass("is-running", p.state.running);

    this.phaseEl = el.createDiv({ cls: "tasky-pomodoro__phase" });

    const ring = el.createDiv({ cls: "tasky-pomodoro__ring" });
    const svg = ring.createSvg("svg", { attr: { viewBox: "0 0 200 200" } });
    svg.createSvg("circle", { cls: "tasky-pomodoro__track", attr: { cx: 100, cy: 100, r: RADIUS } });
    this.arcEl = svg.createSvg("circle", {
      cls: "tasky-pomodoro__arc",
      attr: { cx: 100, cy: 100, r: RADIUS, "stroke-dasharray": CIRCUMFERENCE },
    });
    const center = ring.createDiv({ cls: "tasky-pomodoro__center" });
    this.timeEl = center.createDiv({ cls: "tasky-pomodoro__time" });
    const adjust = center.createDiv({ cls: "tasky-pomodoro__adjust" });
    for (const [label, minutes] of [["−", -1], ["+", 1]] as const) {
      const btn = adjust.createEl("button", { text: label, attr: { "aria-label": `${minutes > 0 ? "Add" : "Remove"} a minute` } });
      btn.addEventListener("click", () => p.adjust(minutes));
    }

    const taskArea = el.createDiv({ cls: "tasky-pomodoro__task" });
    const task = p.task;
    if (task) {
      renderTaskCard(taskArea, this.plugin, task);
      const links = taskArea.createDiv({ cls: "tasky-pomodoro__links" });
      links.createEl("a", { text: "Change task…" }).addEventListener("click", () => this.pickTask());
      links.createEl("a", { text: "Clear task" }).addEventListener("click", () => p.setTask(null));
    } else {
      const choose = taskArea.createEl("a", { cls: "tasky-pomodoro__choose", text: "Choose a task…" });
      choose.addEventListener("click", () => this.pickTask());
    }

    const controls = el.createDiv({ cls: "tasky-pomodoro__controls" });
    const main = controls.createEl("button", {
      cls: "mod-cta",
      text: p.state.running ? "Pause" : p.idle ? "Start" : "Resume",
    });
    main.addEventListener("click", () => p.toggle());
    if (!p.idle) {
      const stop = controls.createEl("button", { text: p.state.phase === "work" ? "Stop" : "Skip break" });
      stop.addEventListener("click", () => p.stop());
    }

    const stats = el.createDiv({ cls: "tasky-pomodoro__stats" });
    stats.createSpan({ cls: "tasky-pomodoro__count", text: String(p.completedToday) });
    stats.createSpan({ text: " completed today" });

    this.update();
  }

  private update() {
    const p = this.plugin.pomodoro;
    if (!this.timeEl) return;
    const remaining = p.remaining;
    this.timeEl.setText(formatClock(remaining));
    this.phaseEl.setText(p.phaseLabel());
    const progress = p.state.total ? 1 - remaining / p.state.total : 0;
    this.arcEl.setAttribute("stroke-dashoffset", String(CIRCUMFERENCE * (1 - progress)));
  }

  private pickTask() {
    new TaskPickerModal(this.plugin, (task) => this.plugin.pomodoro.setTask(task.file)).open();
  }
}

export function renderStatusBar(el: HTMLElement, plugin: Tasky) {
  const p = plugin.pomodoro;
  el.empty();
  el.toggle(!p.idle);
  if (p.idle) return;
  el.toggleClass("is-paused", !p.state.running);
  setIcon(el.createSpan({ cls: "tasky-statusbar__icon" }), p.state.phase === "work" ? "timer" : "coffee");
  el.createSpan({ text: formatClock(p.remaining) });
}
