# Tasky

Tasks as notes for Obsidian: a sidebar panel with a mini calendar, Bases list/board/calendar views, and a pomodoro timer. Modelled on [TaskNotes](https://github.com/callumalpass/tasknotes), without sync, recurrence, an API or webhooks.

<p align="center">
  <img src="docs/board.png" alt="Board view" width="98.5%">
</p>
<p align="center">
  <img src="docs/calendar.png" alt="Calendar view: drag a task to move its date" width="47.9%">
  <img src="docs/list.png" alt="List view" width="50.6%">
</p>
<p align="center">
  <img src="docs/panel.png" alt="Sidebar tasks panel" width="14.4%">
  <img src="docs/pomodoro.png" alt="Pomodoro timer" width="23.5%">
  <img src="docs/quick-add.png" alt="Quick add with live preview" width="60.1%">
</p>

## Use

- **Ribbon checklist icon:** Tasks panel. **+** adds a task.
- **Tasky: Open task views:** creates `Tasks/Tasks.base` (Today, All, Board, Calendar, Done).
- **Ribbon timer icon:** pomodoro. Finished sessions count on the task.

Quick add: `Buy groceries tomorrow at 5pm @home #errands !high` → due date, time, context, tag, priority. `start fri` sets the scheduled date instead.

A task is a note in `Tasks/` tagged `task`, with `status`, `priority`, `due`, `scheduled`, `contexts` and `pomodoros` in its frontmatter.

## Install

```sh
npm install && npm run build
```

Copy `main.js`, `manifest.json`, `styles.css` to `<vault>/.obsidian/plugins/tasky/` and enable it. Needs Obsidian 1.13+ with Bases on.

To release: bump `manifest.json`, push a matching tag (`1.0.2`), publish the draft release.

MIT
