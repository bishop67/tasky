# Tasky

Tasks as notes for Obsidian: a sidebar panel with a mini calendar, Bases list/board/calendar views, and a pomodoro timer. Modelled on [TaskNotes](https://github.com/callumalpass/tasknotes), without sync, recurrence, an API or webhooks.

<p align="center"><img src="docs/board.png" alt="Board view" width="100%"></p>

| ![Calendar view](docs/calendar.png) | ![List view](docs/list.png) |
|:---:|:---:|
| Calendar: drag to move a date | List: follows the base's sort and groups |

| <img src="docs/panel.png" alt="Tasks panel" height="260"> | <img src="docs/pomodoro.png" alt="Pomodoro" height="260"> | <img src="docs/quick-add.png" alt="Quick add" height="260"> |
|:---:|:---:|:---:|
| Sidebar panel | Pomodoro | Quick add with live preview |

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

Copy `main.js`, `manifest.json`, `styles.css` to `<vault>/.obsidian/plugins/tasky/` and enable it. Needs Obsidian 1.10.2+ with Bases on.

To release: bump `manifest.json`, push a matching tag (`1.0.2`), publish the draft release.

MIT
