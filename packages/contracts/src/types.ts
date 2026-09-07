/** Published cross-app contract. Apps must not import each other's source. */

export type EmployeeId = string & { readonly __brand: 'EmployeeId' };
export type RateRecordId = string & { readonly __brand: 'RateRecordId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type BreakdownItemId = string & { readonly __brand: 'BreakdownItemId' };
export type AllocationId = string & { readonly __brand: 'AllocationId' };
export type UserId = string & { readonly __brand: 'UserId' };

export type WeeklyHours = 40 | 32 | 20;

/** Year-month as YYYY-MM */
export type YearMonth = string & { readonly __brand: 'YearMonth' };

/** ISO date YYYY-MM-DD */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

export type DisplayCurrency = 'EUR' | 'USD' | 'GBP';

export type DisplayUnit = 'hours' | 'personMonths' | 'percent' | 'cost';

export interface Employee {
  id: EmployeeId;
  name: string;
  role: string;
  weeklyHours: WeeklyHours;
}

export interface RateRecord {
  id: RateRecordId;
  employeeId: EmployeeId;
  /** Inclusive start; runs until the next record begins. */
  validFrom: IsoDate;
  hourlyCost: number;
}

export interface Project {
  id: ProjectId;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface BreakdownItem {
  id: BreakdownItemId;
  projectId: ProjectId;
  parentId: BreakdownItemId | null;
  name: string;
}

/**
 * Canonical stored effort. Always hours.
 * Display units are conversions at the edge only.
 */
export interface Allocation {
  id: AllocationId;
  breakdownItemId: BreakdownItemId;
  employeeId: EmployeeId;
  month: YearMonth;
  /** Hours — the only stored unit. */
  amount: number;
  /** Bumped on every edit; used to name the assignment that caused over-capacity. */
  editedAt: number;
}

export interface ActiveUser {
  id: UserId;
  name: string;
}

export interface ShellRuntimeProps {
  currency: DisplayCurrency;
  user: ActiveUser;
}

/** Rate snapshot People publishes for Delivery (and capacity consumers). */
export interface RateSnapshot {
  employees: Employee[];
  rates: RateRecord[];
  revision: number;
}

export interface AllocationEditedDetail {
  employeeId: EmployeeId;
  month: YearMonth;
  allocationId: AllocationId;
  editedAt: number;
}

export interface OverCapacityDetail {
  employeeId: EmployeeId;
  month: YearMonth;
  /** Most recently edited allocation contributing to that person-month. */
  causingAllocationId: AllocationId | null;
  totalHours: number;
  capacityHours: number;
}

export const BASELINE_CHANNEL = 'baseline-planning';

export type BaselineEventMap = {
  'baseline:rates-changed': RateSnapshot;
  'baseline:rates-request': undefined;
  'baseline:allocation-edited': AllocationEditedDetail;
  'baseline:over-capacity': OverCapacityDetail[];
  'baseline:shell-context': ShellRuntimeProps;
};

export function asEmployeeId(id: string): EmployeeId {
  return id as EmployeeId;
}
export function asRateRecordId(id: string): RateRecordId {
  return id as RateRecordId;
}
export function asProjectId(id: string): ProjectId {
  return id as ProjectId;
}
export function asBreakdownItemId(id: string): BreakdownItemId {
  return id as BreakdownItemId;
}
export function asAllocationId(id: string): AllocationId {
  return id as AllocationId;
}
export function asUserId(id: string): UserId {
  return id as UserId;
}
export function asYearMonth(value: string): YearMonth {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error(`Invalid YearMonth: ${value}`);
  }
  return value as YearMonth;
}
export function asIsoDate(value: string): IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid IsoDate: ${value}`);
  }
  return value as IsoDate;
}
