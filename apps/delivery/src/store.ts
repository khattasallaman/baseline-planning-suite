import type {
  Allocation,
  AllocationId,
  BreakdownItem,
  BreakdownItemId,
  Employee,
  EmployeeId,
  OverCapacityDetail,
  Project,
  ProjectId,
  RateRecord,
  RateSnapshot,
  YearMonth,
} from '@baseline/contracts';
import {
  asAllocationId,
  asBreakdownItemId,
  asEmployeeId,
  asIsoDate,
  asProjectId,
  asRateRecordId,
  asYearMonth,
  getBus,
} from '@baseline/contracts';
import { monthRange, personMonthHours } from '@baseline/domain';
import seed from '../../../seed/seed.json';

const DB_NAME = 'baseline-delivery';
const DB_VERSION = 1;
const STORE = 'state';

export interface DeliveryState {
  projects: Project[];
  items: BreakdownItem[];
  allocations: Allocation[];
  /** Cached rate snapshot published by People. */
  rateSnapshot: RateSnapshot | null;
  horizonStart: YearMonth;
  horizonMonths: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<DeliveryState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('delivery');
    req.onsuccess = () =>
      resolve((req.result as DeliveryState | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(state: DeliveryState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(state, 'delivery');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function fromSeed(): DeliveryState {
  return {
    projects: seed.projects.map((p) => ({
      ...p,
      id: asProjectId(p.id),
      startDate: asIsoDate(p.startDate),
      endDate: asIsoDate(p.endDate),
    })),
    items: seed.breakdownItems.map((b) => ({
      id: asBreakdownItemId(b.id),
      projectId: asProjectId(b.projectId),
      parentId: b.parentId ? asBreakdownItemId(b.parentId) : null,
      name: b.name,
    })),
    allocations: seed.allocations.map((a) => ({
      id: asAllocationId(a.id),
      breakdownItemId: asBreakdownItemId(a.breakdownItemId),
      employeeId: asEmployeeId(a.employeeId),
      month: asYearMonth(a.month),
      amount: a.amount,
      editedAt: a.editedAt,
    })),
    rateSnapshot: {
      employees: seed.employees.map((e) => ({
        ...e,
        id: asEmployeeId(e.id),
        weeklyHours: e.weeklyHours as 40 | 32 | 20,
      })),
      rates: seed.rates.map((r) => ({
        id: asRateRecordId(r.id),
        employeeId: asEmployeeId(r.employeeId),
        validFrom: asIsoDate(r.validFrom),
        hourlyCost: r.hourlyCost,
      })),
      revision: 0,
    },
    horizonStart: asYearMonth(seed.meta.horizonStart),
    horizonMonths: seed.meta.horizonMonths,
  };
}

let memory: DeliveryState | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function subscribeDelivery(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDeliveryState(): DeliveryState {
  if (!memory) throw new Error('Delivery store not initialised');
  return memory;
}

export function planningMonths(state: DeliveryState): YearMonth[] {
  return monthRange(state.horizonStart, state.horizonMonths);
}

/** Include March 2026 so the reference cell is visible when viewing Ledger migration. */
export function gridMonths(state: DeliveryState, projectId: ProjectId): YearMonth[] {
  const base = planningMonths(state);
  if (projectId === asProjectId('proj-001')) {
    const march = asYearMonth('2026-03');
    if (!base.includes(march)) return [march, ...base];
  }
  return base;
}

async function persist(publishCapacity = true): Promise<void> {
  if (!memory) return;
  await idbSet(memory);
  if (publishCapacity) publishOverCapacity();
  notify();
}

function publishOverCapacity(): void {
  if (!memory?.rateSnapshot) return;
  const details = computeOverCapacity(memory);
  getBus().emit('baseline:over-capacity', details);
}

export function computeOverCapacity(state: DeliveryState): OverCapacityDetail[] {
  const employees = state.rateSnapshot?.employees ?? [];
  const byKey = new Map<string, Allocation[]>();

  for (const alloc of state.allocations) {
    const key = `${alloc.employeeId}|${alloc.month}`;
    const list = byKey.get(key) ?? [];
    list.push(alloc);
    byKey.set(key, list);
  }

  const details: OverCapacityDetail[] = [];
  for (const [key, allocs] of byKey) {
    const [employeeId, month] = key.split('|') as [EmployeeId, YearMonth];
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) continue;
    const capacity = personMonthHours(emp.weeklyHours, month);
    const totalHours = allocs.reduce((s, a) => s + a.amount, 0);
    if (totalHours > capacity + 0.0001) {
      const latest = [...allocs].sort((a, b) => b.editedAt - a.editedAt)[0];
      details.push({
        employeeId,
        month,
        causingAllocationId: latest?.id ?? null,
        totalHours,
        capacityHours: capacity,
      });
    }
  }
  return details;
}

export async function initDeliveryStore(): Promise<DeliveryState> {
  const existing = await idbGet();
  memory = existing ?? fromSeed();
  // Always refresh rate seed cache shape; keep persisted allocations/projects
  if (existing && !existing.rateSnapshot) {
    memory.rateSnapshot = fromSeed().rateSnapshot;
  }
  if (!existing) await idbSet(memory);

  getBus().on('baseline:rates-changed', (snapshot) => {
    if (!memory) return;
    memory = { ...memory, rateSnapshot: snapshot };
    void idbSet(memory);
    publishOverCapacity();
    notify();
  });

  // Ask People for latest rates if it is already mounted
  getBus().emit('baseline:rates-request', undefined);

  publishOverCapacity();
  notify();
  return memory;
}

export function employeeById(id: EmployeeId): Employee | undefined {
  return memory?.rateSnapshot?.employees.find((e) => e.id === id);
}

export function ratesFor(employeeId: EmployeeId): RateRecord[] {
  return memory?.rateSnapshot?.rates.filter((r) => r.employeeId === employeeId) ?? [];
}

export function childrenOf(
  items: BreakdownItem[],
  parentId: BreakdownItemId | null,
  projectId: ProjectId,
): BreakdownItem[] {
  return items.filter(
    (i) => i.projectId === projectId && i.parentId === parentId,
  );
}

export function isLeaf(items: BreakdownItem[], id: BreakdownItemId): boolean {
  return !items.some((i) => i.parentId === id);
}

export function depthOf(items: BreakdownItem[], id: BreakdownItemId): number {
  let depth = 0;
  let current = items.find((i) => i.id === id);
  while (current?.parentId) {
    depth += 1;
    current = items.find((i) => i.id === current!.parentId);
  }
  return depth;
}

export async function renameItem(id: BreakdownItemId, name: string): Promise<void> {
  if (!memory) return;
  memory = {
    ...memory,
    items: memory.items.map((i) => (i.id === id ? { ...i, name } : i)),
  };
  await persist(false);
}

export async function deleteItem(id: BreakdownItemId): Promise<string | null> {
  if (!memory) return null;
  const toDelete = new Set<BreakdownItemId>();
  const collect = (itemId: BreakdownItemId) => {
    toDelete.add(itemId);
    for (const child of memory!.items.filter((i) => i.parentId === itemId)) {
      collect(child.id);
    }
  };
  collect(id);
  memory = {
    ...memory,
    items: memory.items.filter((i) => !toDelete.has(i.id)),
    allocations: memory.allocations.filter(
      (a) => !toDelete.has(a.breakdownItemId),
    ),
  };
  await persist();
  return null;
}

/**
 * R4: adding a child under a leaf moves that leaf's allocations onto the new child
 * (no silent loss).
 */
export async function addChild(
  parentId: BreakdownItemId,
  name: string,
): Promise<{ ok: true; id: BreakdownItemId } | { ok: false; message: string }> {
  if (!memory) return { ok: false, message: 'Store not ready' };
  const parent = memory.items.find((i) => i.id === parentId);
  if (!parent) return { ok: false, message: 'Parent not found' };
  if (depthOf(memory.items, parentId) >= 2) {
    return { ok: false, message: 'Maximum depth is three levels.' };
  }

  const newId = asBreakdownItemId(`wbs-${crypto.randomUUID()}`);
  const wasLeaf = isLeaf(memory.items, parentId);
  const moved = wasLeaf
    ? memory.allocations.map((a) =>
        a.breakdownItemId === parentId ? { ...a, breakdownItemId: newId } : a,
      )
    : memory.allocations;

  memory = {
    ...memory,
    items: [
      ...memory.items,
      {
        id: newId,
        projectId: parent.projectId,
        parentId,
        name,
      },
    ],
    allocations: moved,
  };
  await persist();
  return { ok: true, id: newId };
}

export async function moveItem(
  id: BreakdownItemId,
  newParentId: BreakdownItemId | null,
): Promise<string | null> {
  if (!memory) return 'Store not ready';
  if (newParentId === id) return 'Cannot move onto itself';
  const item = memory.items.find((i) => i.id === id);
  if (!item) return 'Item not found';

  if (newParentId) {
    const parent = memory.items.find((i) => i.id === newParentId);
    if (!parent || parent.projectId !== item.projectId) {
      return 'Parent must be in the same project';
    }
    // Prevent cycles
    let cursor: BreakdownItemId | null = newParentId;
    while (cursor) {
      if (cursor === id) return 'Cannot create a cycle';
      cursor = memory.items.find((i) => i.id === cursor)?.parentId ?? null;
    }
    const parentDepth = depthOf(memory.items, newParentId);
    const subtreeHeight = maxDepthBelow(memory.items, id);
    if (parentDepth + 1 + subtreeHeight > 2) {
      return 'Move would exceed three levels';
    }
  }

  memory = {
    ...memory,
    items: memory.items.map((i) =>
      i.id === id ? { ...i, parentId: newParentId } : i,
    ),
  };
  await persist(false);
  return null;
}

function maxDepthBelow(items: BreakdownItem[], id: BreakdownItemId): number {
  const kids = items.filter((i) => i.parentId === id);
  if (kids.length === 0) return 0;
  return 1 + Math.max(...kids.map((k) => maxDepthBelow(items, k.id)));
}

export async function createRootItem(
  projectId: ProjectId,
  name: string,
): Promise<void> {
  if (!memory) return;
  memory = {
    ...memory,
    items: [
      ...memory.items,
      {
        id: asBreakdownItemId(`wbs-${crypto.randomUUID()}`),
        projectId,
        parentId: null,
        name,
      },
    ],
  };
  await persist(false);
}

export async function setAllocationHours(input: {
  breakdownItemId: BreakdownItemId;
  employeeId: EmployeeId;
  month: YearMonth;
  hours: number;
  existingId?: AllocationId;
}): Promise<AllocationId> {
  if (!memory) throw new Error('Store not ready');
  const editedAt = Date.now();
  let id = input.existingId;

  if (id) {
    memory = {
      ...memory,
      allocations: memory.allocations.map((a) =>
        a.id === id
          ? { ...a, amount: input.hours, editedAt }
          : a,
      ),
    };
  } else {
    const existing = memory.allocations.find(
      (a) =>
        a.breakdownItemId === input.breakdownItemId &&
        a.employeeId === input.employeeId &&
        a.month === input.month,
    );
    if (existing) {
      id = existing.id;
      memory = {
        ...memory,
        allocations: memory.allocations.map((a) =>
          a.id === id ? { ...a, amount: input.hours, editedAt } : a,
        ),
      };
    } else {
      id = asAllocationId(`alloc-${crypto.randomUUID()}`);
      memory = {
        ...memory,
        allocations: [
          ...memory.allocations,
          {
            id,
            breakdownItemId: input.breakdownItemId,
            employeeId: input.employeeId,
            month: input.month,
            amount: input.hours,
            editedAt,
          },
        ],
      };
    }
  }

  getBus().emit('baseline:allocation-edited', {
    employeeId: input.employeeId,
    month: input.month,
    allocationId: id,
    editedAt,
  });

  await persist();
  return id;
}

export function findAllocation(
  state: DeliveryState,
  breakdownItemId: BreakdownItemId,
  employeeId: EmployeeId,
  month: YearMonth,
): Allocation | undefined {
  return state.allocations.find(
    (a) =>
      a.breakdownItemId === breakdownItemId &&
      a.employeeId === employeeId &&
      a.month === month,
  );
}
