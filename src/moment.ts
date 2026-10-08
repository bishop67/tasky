import { moment as obsidianMoment } from "obsidian";

// Obsidian ships moment at runtime, but its types come from the separate `moment` package,
// which the Community directory's scanner doesn't resolve. These are the parts Tasky uses,
// typed here so the code doesn't depend on that package being installed.

type Unit = "day" | "days" | "week" | "weeks" | "month" | "year";

export interface Moment {
  clone(): Moment;
  format(format?: string): string;
  isValid(): boolean;
  add(amount: number, unit: Unit): Moment;
  subtract(amount: number, unit: Unit): Moment;
  startOf(unit: Unit): Moment;
  endOf(unit: Unit): Moment;
  isBefore(other: Moment): boolean;
  isSameOrBefore(other: Moment, unit?: Unit): boolean;
  year(): number;
  year(value: number): Moment;
  month(): number;
  date(): number;
  day(): number;
  hour(value: number): Moment;
  minute(value: number): Moment;
}

interface MomentStatic {
  (input?: string, format?: string | string[], strict?: boolean): Moment;
  weekdaysMin(localeSorted: boolean): string[];
  weekdaysShort(localeSorted: boolean): string[];
}

export const moment = obsidianMoment as unknown as MomentStatic;
