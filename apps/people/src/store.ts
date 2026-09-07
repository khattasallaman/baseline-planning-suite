import type {
  Employee,
  EmployeeId,
  IsoDate,
  RateRecord,
  RateRecordId,
  RateSnapshot,
} from '@baseline/contracts';
import {
  asEmployeeId,
  asIsoDate,
  asRateRecordId,
  getBus,
} from '@baseline/contracts';
import seed from '../../../seed/seed.json';


const DB_NAME = 'baseline-people';
const DB_VERSION = 1;
const STORE = 'state';

export interface PeopleState {
  employees: Employee[];
  rates: RateRecord[];
  revision: number;
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

async function idbGet(): Promise<PeopleState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('people');
    req.onsuccess = () => resolve((req.result as PeopleState | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(state: PeopleState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(state, 'people');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function fromSeed(): PeopleState {
  return {
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
    revision: 1,
  };
}

let memory: PeopleState | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function publishSnapshot(): void {
  if (!memory) return;
  const snapshot: RateSnapshot = {
    employees: memory.employees,
    rates: memory.rates,
    revision: memory.revision,
  };
  getBus().emit('baseline:rates-changed', snapshot);
}

export function subscribePeople(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPeopleState(): PeopleState {
  if (!memory) throw new Error('People store not initialised');
  return memory;
}

export async function initPeopleStore(): Promise<PeopleState> {
  const existing = await idbGet();
  memory = existing ?? fromSeed();
  if (!existing) await idbSet(memory);

  getBus().on('baseline:rates-request', () => {
    publishSnapshot();
  });

  publishSnapshot();
  notify();
  return memory;
}

async function persist(): Promise<void> {
  if (!memory) return;
  memory = { ...memory, revision: memory.revision + 1 };
  await idbSet(memory);
  publishSnapshot();
  notify();
}

export async function upsertRate(
  employeeId: EmployeeId,
  input: { id?: RateRecordId; validFrom: IsoDate; hourlyCost: number },
): Promise<void> {
  if (!memory) return;
  const rates = [...memory.rates];
  if (input.id) {
    const idx = rates.findIndex((r) => r.id === input.id);
    if (idx >= 0) {
      rates[idx] = {
        ...rates[idx],
        validFrom: input.validFrom,
        hourlyCost: input.hourlyCost,
      };
    }
  } else {
    rates.push({
      id: asRateRecordId(`rate-${crypto.randomUUID()}`),
      employeeId,
      validFrom: input.validFrom,
      hourlyCost: input.hourlyCost,
    });
  }
  memory = { ...memory, rates };
  await persist();
}

export async function removeRate(rateId: RateRecordId): Promise<void> {
  if (!memory) return;
  memory = {
    ...memory,
    rates: memory.rates.filter((r) => r.id !== rateId),
  };
  await persist();
}

