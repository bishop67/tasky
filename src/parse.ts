import { Moment, moment } from "./moment";
import type { Draft } from "./tasks";


const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DAYS = "mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DATE =
  `today|tonight|tomorrow|tmrw?|next week|in \\d+ (?:days?|weeks?)|(?:next |this )?(?:${DAYS})` +
  `|\\d{4}-\\d{2}-\\d{2}|(?:${MONTHS}) \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})`;
const TIME = `(?:at )?\\d{1,2}(?::\\d{2})? ?(?:am|pm)|(?:at )?\\d{1,2}:\\d{2}|at \\d{1,2}`;
const SCHEDULE_WORDS = ["scheduled", "sched", "start", "on"];

const DATE_RE = new RegExp(`(^|\\s)(?:(due|by|scheduled|sched|start|on) )?(${DATE})(?: (${TIME}))?(?=\\s|$)`, "i");
const TIME_RE = new RegExp(`(^|\\s)(?:(due|by|scheduled|sched|start|on) )?(at \\d{1,2}(?::\\d{2})? ?(?:am|pm)?)(?=\\s|$)`, "i");
const PRIORITY_RE = /(^|\s)!(high|normal|low|h|n|l)(?=\s|$)/i;
const TAG_RE = /(^|\s)#([^\s#@!]+)/g;
const CONTEXT_RE = /(^|\s)@([^\s#@!]+)/g;

function resolveDay(text: string, now: Moment): Moment | null {
  const t = text.toLowerCase();
  const today = now.clone().startOf("day");
  if (t === "today" || t === "tonight") return today;
  if (/^(tomorrow|tmrw?)$/.test(t)) return today.add(1, "day");
  if (t === "next week") return today.add(7, "days");
  const inN = t.match(/^in (\d+) (day|week)/);
  if (inN) return today.add(Number(inN[1]), inN[2] === "day" ? "days" : "weeks");
  const weekday = t.replace(/^(next|this) /, "");
  const dow = DAY_NAMES.indexOf(weekday.slice(0, 3));
  if (dow >= 0 && new RegExp(`^(?:${DAYS})$`).test(weekday)) {
    const diff = (dow - today.day() + 7) % 7;
    return today.add(t.startsWith("this ") ? diff : diff || 7, "days");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return moment(t, "YYYY-MM-DD", true);
  const md = moment(t.replace(/(st|nd|rd|th)\b/, ""), ["MMM D", "MMMM D", "D MMM", "D MMMM"], true);
  if (md.isValid()) {
    // A date a few weeks back is late, not next year's.
    md.year(today.year());
    if (md.isBefore(today.clone().subtract(60, "days"))) md.add(1, "year");
    return md;
  }
  return null;
}

function resolveTime(text: string): [number, number] | null {
  const m = text.toLowerCase().match(/(\d{1,2})(?::(\d{2}))? ?(am|pm)?/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (m[3] === "pm" && hour < 12) hour += 12;
  if (m[3] === "am" && hour === 12) hour = 0;
  return hour < 24 && minute < 60 ? [hour, minute] : null;
}

const stamp = (day: Moment, time: [number, number] | null) =>
  time ? day.clone().hour(time[0]).minute(time[1]).format("YYYY-MM-DDTHH:mm") : day.format("YYYY-MM-DD");

// "Buy milk tomorrow at 5pm @home #errands !high" → title, dates, contexts, tags, priority.
// A date goes to `due` unless it follows "scheduled", "start" or "on".
export function parseQuickAdd(input: string, now: Moment = moment()): Omit<Draft, "status"> {
  let text = ` ${input.replace(/\s+/g, " ")} `;
  const draft: Omit<Draft, "status"> = { title: "", contexts: [], tags: [] };

  text = text.replace(TAG_RE, (_: string, lead: string, tag: string) => (draft.tags.push(tag), lead));
  text = text.replace(CONTEXT_RE, (_: string, lead: string, ctx: string) => (draft.contexts.push(ctx), lead));
  text = text.replace(PRIORITY_RE, (_: string, lead: string, p: string) => {
    draft.priority = { h: "high", n: "normal", l: "low" }[p[0].toLowerCase()];
    return lead;
  });

  for (let i = 0; i < 2; i++) {
    const m = text.match(DATE_RE);
    if (!m) break;
    const day = resolveDay(m[3], now);
    if (!day) break;
    const field = SCHEDULE_WORDS.includes((m[2] ?? "").toLowerCase()) ? "scheduled" : "due";
    if (draft[field]) break;
    draft[field] = stamp(day, m[4] ? resolveTime(m[4]) : null);
    text = text.replace(m[0], m[1]);
  }

  if (!draft.due && !draft.scheduled) {
    const m = text.match(TIME_RE);
    const time = m && resolveTime(m[3]);
    if (m && time) {
      const field = SCHEDULE_WORDS.includes((m[2] ?? "").toLowerCase()) ? "scheduled" : "due";
      draft[field] = stamp(now.clone().startOf("day"), time);
      text = text.replace(m[0], m[1]);
    }
  }

  draft.title = text.replace(/\s+/g, " ").trim();
  return draft;
}
