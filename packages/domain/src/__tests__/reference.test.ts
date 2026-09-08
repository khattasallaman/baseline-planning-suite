import { describe, expect, it } from 'vitest';
import {
  asEmployeeId,
  asIsoDate,
  asRateRecordId,
  asYearMonth,
  type RateRecord,
} from '@baseline/contracts';
import {
  allocationCost,
  blendedRate,
  countWorkingDaysInMonth,
  displayToHours,
  hasRateCoverageForMonth,
  hoursToDisplay,
  largestRemainderRound,
  listWorkingDaysInMonth,
  personMonthHours,
  rateSlicesForMonth,
  roundTo,
} from '../index';

const MARCH = asYearMonth('2026-03');
const EMP = asEmployeeId('emp-okafor');

const okaforRates: RateRecord[] = [
  {
    id: asRateRecordId('rate-okafor-1'),
    employeeId: EMP,
    validFrom: asIsoDate('2025-01-01'),
    hourlyCost: 80,
  },
  {
    id: asRateRecordId('rate-okafor-2'),
    employeeId: EMP,
    validFrom: asIsoDate('2026-03-12'),
    hourlyCost: 95,
  },
];

describe('R1 reference calculation — A. Okafor March 2026', () => {
  it('has 22 working days in March 2026', () => {
    expect(countWorkingDaysInMonth(MARCH)).toBe(22);
  });

  it('splits 8 working days before 12 Mar and 14 from 12 Mar on', () => {
    const slices = rateSlicesForMonth(MARCH, okaforRates);
    expect(slices).toHaveLength(2);
    expect(slices[0].workingDays).toBe(8);
    expect(slices[0].hourlyCost).toBe(80);
    expect(slices[1].workingDays).toBe(14);
    expect(slices[1].hourlyCost).toBe(95);
  });

  it('person-month hours = 40 × 22 / 5 = 176', () => {
    expect(personMonthHours(40, MARCH)).toBe(176);
  });

  it('0.50 person-months = 88 hours', () => {
    const hours = displayToHours(0.5, 'personMonths', {
      weeklyHours: 40,
      month: MARCH,
      employeeRates: okaforRates,
    });
    expect(hours).toBe(88);
  });

  it('cost = €7,880.00', () => {
    const cost = allocationCost(88, MARCH, okaforRates);
    expect(roundTo(cost, 2)).toBe(7880);
  });

  it('same cell as % of capacity = 50.0%', () => {
    const pct = hoursToDisplay(88, 'percent', {
      weeklyHours: 40,
      month: MARCH,
      employeeRates: okaforRates,
    });
    expect(roundTo(pct, 1)).toBe(50);
  });

  it('implied blended rate ≈ €89.5455/h', () => {
    const rate = blendedRate(88, MARCH, okaforRates);
    expect(rate).not.toBeNull();
    expect(roundTo(rate!, 4)).toBe(89.5455);
  });

  it('editing cost via blended rate round-trips to the same hours', () => {
    const hours = displayToHours(7880, 'cost', {
      weeklyHours: 40,
      month: MARCH,
      employeeRates: okaforRates,
    });
    expect(roundTo(hours, 2)).toBe(88);
  });
});

describe('working-day arithmetic', () => {
  it('lists only Mon–Fri', () => {
    const days = listWorkingDaysInMonth(MARCH);
    expect(days).toHaveLength(22);
    expect(days[0]).toBe('2026-03-02');
    expect(days.includes(asIsoDate('2026-03-01'))).toBe(false); // Sunday
    expect(days.includes(asIsoDate('2026-03-12'))).toBe(true); // Thursday
  });

  it('validFrom day is priced at the new rate (inclusive)', () => {
    const slices = rateSlicesForMonth(MARCH, okaforRates);
    expect(slices[1].from).toBe('2026-03-12');
  });

  it('month before first rate yields no slices (cost zero)', () => {
    const early = asYearMonth('2024-06');
    expect(rateSlicesForMonth(early, okaforRates)).toHaveLength(0);
    expect(allocationCost(40, early, okaforRates)).toBe(0);
  });
});

describe('more than one rate change in a month', () => {
  const thirdRate: RateRecord = {
    id: asRateRecordId('rate-okafor-3'),
    employeeId: EMP,
    validFrom: asIsoDate('2026-03-23'),
    hourlyCost: 110,
  };

  it('yields one slice per boundary, covering every working day', () => {
    const slices = rateSlicesForMonth(MARCH, [...okaforRates, thirdRate]);
    expect(slices.map((s) => s.workingDays)).toEqual([8, 7, 7]);
    expect(slices.map((s) => s.hourlyCost)).toEqual([80, 95, 110]);
    const covered = slices.reduce((sum, s) => sum + s.workingDays, 0);
    expect(covered).toBe(countWorkingDaysInMonth(MARCH));
  });

  it('prices each slice at its own rate', () => {
    // 4 h/working day × (8 × 80 + 7 × 95 + 7 × 110)
    const cost = allocationCost(88, MARCH, [...okaforRates, thirdRate]);
    expect(roundTo(cost, 2)).toBe(8300);
  });

  it('a boundary on a weekend takes effect on the next working day', () => {
    const saturday: RateRecord = {
      id: asRateRecordId('rate-okafor-sat'),
      employeeId: EMP,
      validFrom: asIsoDate('2026-03-14'),
      hourlyCost: 95,
    };
    const slices = rateSlicesForMonth(MARCH, [okaforRates[0], saturday]);
    expect(slices.map((s) => s.workingDays)).toEqual([10, 12]);
    expect(roundTo(allocationCost(88, MARCH, [okaforRates[0], saturday]), 2)).toBe(7760);
  });

  it('removing a rate retroactively reprices the month', () => {
    // With the 12 Mar record gone the whole month falls back to €80/h.
    expect(roundTo(allocationCost(88, MARCH, [okaforRates[0]]), 2)).toBe(7040);
  });
});

describe('unit conversion stability (R2)', () => {
  it('hours → personMonths → hours preserves value', () => {
    const ctx = {
      weeklyHours: 40 as const,
      month: MARCH,
      employeeRates: okaforRates,
    };
    const back = displayToHours(hoursToDisplay(88, 'personMonths', ctx), 'personMonths', ctx);
    expect(back).toBe(88);
  });

  it('hours → percent → hours preserves value', () => {
    const ctx = {
      weeklyHours: 40 as const,
      month: MARCH,
      employeeRates: okaforRates,
    };
    expect(displayToHours(hoursToDisplay(88, 'percent', ctx), 'percent', ctx)).toBe(88);
  });

  it('a month with no rate cover prices at zero and is markable', () => {
    const early = asYearMonth('2024-06');
    expect(hasRateCoverageForMonth(early, okaforRates)).toBe(false);
    expect(hasRateCoverageForMonth(MARCH, okaforRates)).toBe(true);
    expect(
      hoursToDisplay(88, 'cost', {
        weeklyHours: 40,
        month: early,
        employeeRates: okaforRates,
      }),
    ).toBe(0);
  });

  it('person-month size varies by weekly hours', () => {
    expect(personMonthHours(40, MARCH)).toBe(176);
    expect(personMonthHours(32, MARCH)).toBe(140.8);
    expect(personMonthHours(20, MARCH)).toBe(88);
  });
});

describe('largest-remainder totals (R3)', () => {
  it('rounded parts sum to rounded total', () => {
    const values = [1.004, 1.004, 1.004];
    const rounded = largestRemainderRound(values, 2);
    const sum = roundTo(
      rounded.reduce((a, b) => a + b, 0),
      2,
    );
    expect(sum).toBe(roundTo(3.012, 2));
    expect(rounded.reduce((a, b) => a + b, 0)).toBeCloseTo(sum, 10);
  });

  it('reconciles where independent rounding would not', () => {
    // Rounding each cell on its own gives 0.34 + 0.34 + 0.33 = 1.01 against a 1.00 total.
    const values = [0.335, 0.335, 0.33];
    const rounded = largestRemainderRound(values, 2);
    const displayedTotal = roundTo(
      values.reduce((a, b) => a + b, 0),
      2,
    );
    expect(roundTo(rounded.reduce((a, b) => a + b, 0), 2)).toBe(displayedTotal);
    expect(rounded).toHaveLength(values.length);
  });

  it('keeps each cell within one display unit of its exact value', () => {
    const values = [1.006, 2.004, 3.005, 0.985];
    const rounded = largestRemainderRound(values, 2);
    rounded.forEach((r, i) => expect(Math.abs(r - values[i]!)).toBeLessThanOrEqual(0.01));
    expect(roundTo(rounded.reduce((a, b) => a + b, 0), 2)).toBe(
      roundTo(values.reduce((a, b) => a + b, 0), 2),
    );
  });

  it('empty input', () => {
    expect(largestRemainderRound([], 2)).toEqual([]);
  });
});

describe('display currency FX', () => {
  it('converts EUR cost to USD and back', async () => {
    const { fromEur, toEur } = await import('../index');
    expect(fromEur(7880, 'USD')).toBeCloseTo(8510.4, 5);
    expect(toEur(8510.4, 'USD')).toBeCloseTo(7880, 5);
  });
});
