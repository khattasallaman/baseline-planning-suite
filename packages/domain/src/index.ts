import type {
  DisplayUnit,
  IsoDate,
  RateRecord,
  WeeklyHours,
  YearMonth,
} from '@baseline/contracts';
import { asIsoDate, asYearMonth } from '@baseline/contracts';


const MS_PER_DAY = 86_400_000;

export function parseYearMonth(month: YearMonth): { year: number; monthIndex: number } {
  const [y, m] = month.split('-').map(Number);
  return { year: y, monthIndex: m - 1 };
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function toIsoDate(year: number, monthIndex: number, day: number): IsoDate {
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return asIsoDate(`${year}-${mm}-${dd}`);
}

/** Monday–Friday only. Public holidays ignored. */
export function isWorkingDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

export function listWorkingDaysInMonth(month: YearMonth): IsoDate[] {
  const { year, monthIndex } = parseYearMonth(month);
  const total = daysInMonth(year, monthIndex);
  const result: IsoDate[] = [];
  for (let day = 1; day <= total; day += 1) {
    const date = new Date(Date.UTC(year, monthIndex, day));
    if (isWorkingDay(date)) {
      result.push(toIsoDate(year, monthIndex, day));
    }
  }
  return result;
}

export function countWorkingDaysInMonth(month: YearMonth): number {
  return listWorkingDaysInMonth(month).length;
}

/**
 * One person-month in hours for this person and month:
 * weeklyHours × (workingDays / 5)
 */
export function personMonthHours(weeklyHours: WeeklyHours, month: YearMonth): number {
  const workingDays = countWorkingDaysInMonth(month);
  return weeklyHours * (workingDays / 5);
}

export interface RateSlice {
  from: IsoDate;
  to: IsoDate; // inclusive
  hourlyCost: number;
  workingDays: number;
}

function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addDaysIso(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return asIsoDate(d.toISOString().slice(0, 10));
}

function prevDay(date: IsoDate): IsoDate {
  return addDaysIso(date, -1);
}

/**
 * Rates apply from validFrom (inclusive) until the next record starts.
 * Sorted ascending by validFrom.
 */
export function sortRates(rates: RateRecord[]): RateRecord[] {
  return [...rates].sort((a, b) => compareIso(a.validFrom, b.validFrom));
}

/**
 * Split a calendar month into working-day slices at each rate boundary.
 * Allocations before the employee's first rate cost zero (caller marks the cell).
 */
export function rateSlicesForMonth(
  month: YearMonth,
  employeeRates: RateRecord[],
): RateSlice[] {
  const workingDays = listWorkingDaysInMonth(month);
  if (workingDays.length === 0) return [];

  const monthStart = workingDays[0];
  const monthEnd = workingDays[workingDays.length - 1];
  const rates = sortRates(employeeRates);

  if (rates.length === 0) return [];

  const firstRate = rates[0];
  if (compareIso(monthEnd, firstRate.validFrom) < 0) {
    return [];
  }

  const boundaries: IsoDate[] = [];
  for (const rate of rates) {
    if (
      compareIso(rate.validFrom, monthStart) > 0 &&
      compareIso(rate.validFrom, monthEnd) <= 0
    ) {
      boundaries.push(rate.validFrom);
    }
  }

  const sliceStarts: IsoDate[] = [monthStart, ...boundaries];
  const slices: RateSlice[] = [];

  for (let i = 0; i < sliceStarts.length; i += 1) {
    const from = sliceStarts[i];
    const to =
      i + 1 < sliceStarts.length ? prevDay(sliceStarts[i + 1]) : monthEnd;

    const rate = effectiveRateOn(from, rates);
    if (rate === null) continue;

    const days = workingDays.filter(
      (d) => compareIso(d, from) >= 0 && compareIso(d, to) <= 0,
    ).length;

    if (days > 0) {
      slices.push({ from, to, hourlyCost: rate.hourlyCost, workingDays: days });
    }
  }

  return slices;
}

export function effectiveRateOn(
  date: IsoDate,
  employeeRates: RateRecord[],
): RateRecord | null {
  const rates = sortRates(employeeRates);
  let current: RateRecord | null = null;
  for (const rate of rates) {
    if (compareIso(rate.validFrom, date) <= 0) {
      current = rate;
    } else {
      break;
    }
  }
  return current;
}

export function hasRateCoverageForMonth(
  month: YearMonth,
  employeeRates: RateRecord[],
): boolean {
  return rateSlicesForMonth(month, employeeRates).length > 0;
}

/**
 * Cost of an allocation (hours) for a month, splitting across mid-month rate changes.
 * Hours are spread evenly across working days.
 */
export function allocationCost(
  allocationHours: number,
  month: YearMonth,
  employeeRates: RateRecord[],
): number {
  const workingDays = countWorkingDaysInMonth(month);
  if (workingDays === 0 || allocationHours === 0) return 0;

  const slices = rateSlicesForMonth(month, employeeRates);
  if (slices.length === 0) return 0;

  const hoursPerDay = allocationHours / workingDays;
  let cost = 0;
  for (const slice of slices) {
    cost += slice.workingDays * hoursPerDay * slice.hourlyCost;
  }
  return cost;
}

/** Blended €/h for the month given this allocation's spread. */
export function blendedRate(
  allocationHours: number,
  month: YearMonth,
  employeeRates: RateRecord[],
): number | null {
  if (allocationHours === 0) return null;
  const cost = allocationCost(allocationHours, month, employeeRates);
  if (!hasRateCoverageForMonth(month, employeeRates)) return null;
  return cost / allocationHours;
}

export type { DisplayUnit };

export interface ConversionContext {
  weeklyHours: WeeklyHours;
  month: YearMonth;
  employeeRates: RateRecord[];
}

/** Convert stored hours → display value. */
export function hoursToDisplay(
  hours: number,
  unit: DisplayUnit,
  ctx: ConversionContext,
): number {
  const pm = personMonthHours(ctx.weeklyHours, ctx.month);
  switch (unit) {
    case 'hours':
      return hours;
    case 'personMonths':
      return pm === 0 ? 0 : hours / pm;
    case 'percent':
      return pm === 0 ? 0 : (hours / pm) * 100;
    case 'cost':
      return allocationCost(hours, ctx.month, ctx.employeeRates);
    default: {
      const _exhaustive: never = unit;
      return _exhaustive;
    }
  }
}

/**
 * Convert a display edit back to canonical hours.
 * Cost edits in a split-rate month divide by the blended rate.
 */
export function displayToHours(
  value: number,
  unit: DisplayUnit,
  ctx: ConversionContext,
): number {
  const pm = personMonthHours(ctx.weeklyHours, ctx.month);
  switch (unit) {
    case 'hours':
      return value;
    case 'personMonths':
      return value * pm;
    case 'percent':
      return (value / 100) * pm;
    case 'cost': {
      const probeHours = pm > 0 ? pm : 1;
      const rate = blendedRate(probeHours, ctx.month, ctx.employeeRates);
      if (rate === null || rate === 0) return 0;
      return value / rate;
    }
    default: {
      const _exhaustive: never = unit;
      return _exhaustive;
    }
  }
}

export const DISPLAY_PRECISION: Record<DisplayUnit, number> = {
  hours: 2,
  personMonths: 2,
  percent: 1,
  cost: 2,
};

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Largest-remainder distribution so rounded parts sum exactly to the rounded total.
 * R3: displayed total must equal the sum of displayed cells.
 */
export function largestRemainderRound(
  values: number[],
  decimals: number,
): number[] {
  if (values.length === 0) return [];

  const factor = 10 ** decimals;
  const exactTotal = values.reduce((sum, v) => sum + v, 0);
  const target = Math.round(exactTotal * factor);

  const scaled = values.map((v, index) => {
    const exact = v * factor;
    const floor = Math.floor(exact);
    return { index, floor, frac: exact - floor };
  });

  const floorSum = scaled.reduce((sum, s) => sum + s.floor, 0);
  let remainder = target - floorSum;

  scaled.sort((a, b) => b.frac - a.frac || a.index - b.index);

  const result = values.map(() => 0);
  for (const item of scaled) {
    let units = item.floor;
    if (remainder > 0) {
      units += 1;
      remainder -= 1;
    } else if (remainder < 0) {
      units -= 1;
      remainder += 1;
    }
    result[item.index] = units / factor;
  }

  return result;
}

export function monthRange(start: YearMonth, count: number): YearMonth[] {
  const { year, monthIndex } = parseYearMonth(start);
  const months: YearMonth[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(year, monthIndex + i, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    months.push(asYearMonth(`${y}-${m}`));
  }
  return months;
}

export function utcTodayIso(): IsoDate {
  return asIsoDate(new Date().toISOString().slice(0, 10));
}

/** Exported for tests that need day arithmetic without calendar quirks. */
export function dayDiff(a: IsoDate, b: IsoDate): number {
  const da = new Date(`${a}T00:00:00.000Z`).getTime();
  const db = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.round((db - da) / MS_PER_DAY);
}

/**
 * Rates are stored in EUR. Shell display currency converts at the edge only.
 * Fixed demo FX — not live market data.
 */
export const FX_FROM_EUR: Record<'EUR' | 'USD' | 'GBP', number> = {
  EUR: 1,
  USD: 1.08,
  GBP: 0.86,
};

export function fromEur(
  amountEur: number,
  currency: 'EUR' | 'USD' | 'GBP',
): number {
  return amountEur * FX_FROM_EUR[currency];
}

export function toEur(
  amount: number,
  currency: 'EUR' | 'USD' | 'GBP',
): number {
  const rate = FX_FROM_EUR[currency];
  return rate === 0 ? 0 : amount / rate;
}

export function currencySymbol(currency: 'EUR' | 'USD' | 'GBP'): string {
  if (currency === 'EUR') return '€';
  if (currency === 'GBP') return '£';
  return '$';
}
