/**
 * Fixture seed — fixed IDs. Counts match the brief.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ROLES = [
  'Senior Engineer', 'Engineer', 'Tech Lead', 'Delivery Manager',
  'Analyst', 'Architect', 'QA Engineer', 'Designer',
];
const WEEKLY = [40, 32, 20];

const NAMES = [
  'A. Okafor', 'M. Brandt', 'S. Haddad', 'L. Okafor', 'J. Nguyen',
  'K. Silva', 'R. Kowalski', 'T. Andersen', 'N. Petrov', 'P. Moreau',
  'C. Berg', 'D. Costa', 'E. Ivanov', 'F. Murphy', 'G. Santos',
  'H. Weber', 'I. Rossi', 'O. Kim', 'U. Ali', 'V. Novak',
  'J. Johansson', 'K. Papadopoulos', 'R. Horvat', 'T. Nielsen', 'N. Dumont',
  'P. Fischer', 'C. Lopez', 'D. Brown', 'E. Yamamoto', 'F. Singh',
  'G. Chen', 'H. Meier', 'I. Popov', 'O. Garcia', 'U. Schmidt',
  'V. Wilson', 'J. Taylor', 'K. Andersson', 'R. Lefevre', 'T. Bakker',
  'N. Jensen', 'P. Kovač', 'C. Nowak', 'D. Fernandez', 'E. Rahman',
  'F. Osei', 'G. Diallo', 'H. Bianchi', 'I. Hughes', 'O. Clarke',
  'U. Murray', 'V. Walsh', 'J. Reeves', 'K. Porter', 'R. Hayes',
  'T. Fox', 'N. West', 'P. Lane', 'C. Reed', 'D. Cole',
];

function id(prefix, n) {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function monthAdd(start, offset) {
  const [y, m] = start.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const employees = NAMES.map((name, i) => ({
  id: id('emp', i + 1),
  name,
  role: ROLES[i % ROLES.length],
  weeklyHours: i === 0 ? 40 : WEEKLY[i % WEEKLY.length],
}));

const rates = [];
let rateN = 1;
const midMonthIdx = [0, 1, 5, 8, 12, 18, 22, 27, 33, 41];

for (let i = 0; i < 60; i++) {
  const base = 55 + (i % 25) * 2;
  rates.push({
    id: id('rate', rateN++),
    employeeId: employees[i].id,
    validFrom: '2025-01-01',
    hourlyCost: i === 0 ? 80 : round2(base),
  });
}

for (let i = 0; i < 60 && rates.length < 150; i++) {
  const base = 55 + (i % 25) * 2;
  if (i === 0) {
    rates.push({
      id: id('rate', rateN++),
      employeeId: employees[i].id,
      validFrom: '2026-03-12',
      hourlyCost: 95,
    });
  } else if (midMonthIdx.includes(i)) {
    rates.push({
      id: id('rate', rateN++),
      employeeId: employees[i].id,
      validFrom: '2026-06-15',
      hourlyCost: round2(base + 10),
    });
  } else {
    rates.push({
      id: id('rate', rateN++),
      employeeId: employees[i].id,
      validFrom: '2026-01-01',
      hourlyCost: round2(base + 6),
    });
  }
}

for (let i = 0; i < 60 && rates.length < 150; i++) {
  if (i === 0 || midMonthIdx.includes(i)) continue;
  rates.push({
    id: id('rate', rateN++),
    employeeId: employees[i].id,
    validFrom: '2026-09-01',
    hourlyCost: round2(70 + (i % 15)),
  });
}

while (rates.length < 150) {
  const i = rates.length % 60;
  rates.push({
    id: id('rate', rateN++),
    employeeId: employees[i].id,
    validFrom: `2024-${String((rates.length % 11) + 1).padStart(2, '0')}-01`,
    hourlyCost: round2(50 + (rates.length % 30)),
  });
}
rates.length = 150;

const projects = [
  { id: 'proj-001', name: 'Ledger migration', startDate: '2026-04-01', endDate: '2027-03-31' },
  { id: 'proj-002', name: 'Reporting cut-over', startDate: '2026-05-01', endDate: '2027-02-28' },
  { id: 'proj-003', name: 'Platform hardening', startDate: '2026-04-01', endDate: '2026-12-31' },
  { id: 'proj-004', name: 'Client onboarding', startDate: '2026-06-01', endDate: '2027-03-31' },
];

const breakdownItems = [];
let wbsN = 1;
const leaves = [];

const structure = {
  'proj-001': [3, 3, 3, 3, 3, 3],
  'proj-002': [3, 3, 3, 3, 3, 3],
  'proj-003': [3, 3, 3, 3, 3],
  'proj-004': [3, 3, 3, 2, 2],
};

for (const project of projects) {
  const rootId = id('wbs', wbsN++);
  breakdownItems.push({
    id: rootId,
    projectId: project.id,
    parentId: null,
    name: project.name,
  });

  structure[project.id].forEach((leafCount, p) => {
    const pkgId = id('wbs', wbsN++);
    breakdownItems.push({
      id: pkgId,
      projectId: project.id,
      parentId: rootId,
      name: p === 0 && project.id === 'proj-001' ? 'Core migration' : `Work package ${p + 1}`,
    });
    for (let l = 0; l < leafCount; l++) {
      const leaf = {
        id: id('wbs', wbsN++),
        projectId: project.id,
        parentId: pkgId,
        name:
          project.id === 'proj-001' && p === 0 && l === 0
            ? 'Schema cut'
            : `Task ${p + 1}.${l + 1}`,
      };
      breakdownItems.push(leaf);
      leaves.push(leaf);
    }
  });
}

const HORIZON_START = '2026-04';
const months = Array.from({ length: 12 }, (_, i) => monthAdd(HORIZON_START, i));
const peoplePool = employees.slice(0, 24);

const allocations = [
  {
    id: id('alloc', 1),
    breakdownItemId: leaves[0].id,
    employeeId: employees[0].id,
    month: '2026-03',
    amount: 88,
    editedAt: 1,
  },
];

// Deterministic fill to exactly 720 without a search loop
let allocN = 2;
for (let i = 0; allocations.length < 720; i++) {
  const leaf = leaves[i % leaves.length];
  const person = peoplePool[Math.floor(i / leaves.length) % peoplePool.length];
  const month = months[Math.floor(i / (leaves.length * peoplePool.length)) % months.length];
  // Skip the reference key if we collide
  if (
    leaf.id === leaves[0].id &&
    person.id === employees[0].id &&
    month === '2026-03'
  ) {
    continue;
  }
  // Use unique combo via i encoding — force uniqueness with month cycling + person + leaf
  const m = months[i % months.length];
  const p = peoplePool[Math.floor(i / months.length) % peoplePool.length];
  const l = leaves[Math.floor(i / (months.length * peoplePool.length)) % leaves.length];
  allocations.push({
    id: id('alloc', allocN++),
    breakdownItemId: l.id,
    employeeId: p.id,
    month: m,
    amount: round2(((i % 19) + 1) * 7.25),
    editedAt: allocN,
  });
}

// Dedupe by key keeping first 720 unique
const unique = [];
const seen = new Set();
for (const a of allocations) {
  const key = `${a.breakdownItemId}|${a.employeeId}|${a.month}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(a);
  if (unique.length === 720) break;
}

// If short, pad with remaining combos
outer: for (const leaf of leaves) {
  for (const person of peoplePool) {
    for (const month of months) {
      if (unique.length >= 720) break outer;
      const key = `${leaf.id}|${person.id}|${month}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        id: id('alloc', allocN++),
        breakdownItemId: leaf.id,
        employeeId: person.id,
        month,
        amount: round2(((unique.length % 19) + 1) * 7.25),
        editedAt: allocN,
      });
    }
  }
}

const seed = {
  meta: {
    horizonStart: HORIZON_START,
    horizonMonths: 12,
    canonicalUnit: 'hours',
    reference: {
      employeeId: employees[0].id,
      employeeName: 'A. Okafor',
      month: '2026-03',
      breakdownItemId: leaves[0].id,
      allocationId: unique[0].id,
      expected: {
        workingDays: 22,
        beforeChange: 8,
        fromChange: 14,
        personMonthHours: 176,
        allocationHours: 88,
        costEur: 7880,
        percentCapacity: 50,
        blendedRate: 89.5455,
      },
    },
  },
  employees,
  rates,
  projects,
  breakdownItems,
  allocations: unique,
};

writeFileSync(join(root, 'seed/seed.json'), JSON.stringify(seed, null, 2));

const midMonth = rates.filter((r) => Number(r.validFrom.slice(8, 10)) !== 1).length;

console.log({
  employees: employees.length,
  rates: rates.length,
  projects: projects.length,
  breakdownItems: breakdownItems.length,
  leaves: leaves.length,
  allocations: unique.length,
  midMonthRates: midMonth,
});
