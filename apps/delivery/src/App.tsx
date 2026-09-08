import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type {
  AllocationId,
  BreakdownItem,
  BreakdownItemId,
  DisplayCurrency,
  DisplayUnit,
  Employee,
  EmployeeId,
  ProjectId,
  ShellRuntimeProps,
  YearMonth,
} from '@baseline/contracts';
import { asBreakdownItemId, asProjectId, asYearMonth } from '@baseline/contracts';
import {
  DISPLAY_PRECISION,
  currencySymbol,
  displayToHours,
  fromEur,
  hasRateCoverageForMonth,
  hoursToDisplay,
  largestRemainderRound,
  roundTo,
  toEur,
} from '@baseline/domain';
import {
  addChild,
  computeOverCapacity,
  createRootItem,
  deleteItem,
  depthOf,
  employeeById,
  findAllocation,
  getDeliveryState,
  gridMonths,
  initDeliveryStore,
  isLeaf,
  moveItem,
  ratesFor,
  renameItem,
  resetToSeed,
  setAllocationHours,
  subscribeDelivery,
  type DeliveryState,
} from './store';
import './styles.css';

export interface DeliveryAppProps {
  currency?: DisplayCurrency;
  user?: ShellRuntimeProps['user'];
}

const empty: DeliveryState = {
  projects: [],
  items: [],
  allocations: [],
  rateSnapshot: null,
  horizonStart: asYearMonth('2026-04'),
  horizonMonths: 12,
};

const UNIT_LABEL: Record<DisplayUnit, string> = {
  hours: 'Hours',
  personMonths: 'Person-months',
  percent: '% of capacity',
  cost: 'Cost',
};

interface TreeNode {
  item: BreakdownItem;
  children: TreeNode[];
}

type FlatRow =
  | { kind: 'item'; item: BreakdownItem; depth: number }
  | { kind: 'person'; item: BreakdownItem; employee: Employee; depth: number };

export default function DeliveryApp({
  currency = 'EUR',
  user,
}: DeliveryAppProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<ProjectId>(asProjectId('proj-001'));
  const [unit, setUnit] = useState<DisplayUnit>('personMonths');
  const [message, setMessage] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'wbs' | 'grid'>('grid');

  const state = useSyncExternalStore(
    subscribeDelivery,
    () => (ready ? getDeliveryState() : empty),
    () => empty,
  );

  useEffect(() => {
    initDeliveryStore()
      .then(() => setReady(true))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Failed to load delivery'),
      );
  }, []);

  const months = useMemo(
    () => (ready ? gridMonths(state, projectId) : []),
    [ready, state, projectId],
  );

  /**
   * R5: the overage is attributed to the most recently edited allocation in that
   * person-month, named by person and work package so the cause is identifiable.
   */
  const overByAlloc = useMemo(() => {
    const map = new Map<AllocationId, string>();
    if (!ready) return map;
    for (const o of computeOverCapacity(state)) {
      if (!o.causingAllocationId) continue;
      const alloc = state.allocations.find((a) => a.id === o.causingAllocationId);
      const item = state.items.find((i) => i.id === alloc?.breakdownItemId);
      const person = employeeById(o.employeeId)?.name ?? o.employeeId;
      map.set(
        o.causingAllocationId,
        `Over capacity in ${o.month}: ${person} is committed ` +
          `${roundTo(o.totalHours, 2)}h against ${roundTo(o.capacityHours, 2)}h capacity ` +
          `across all projects. Caused by the latest edit on ${item?.name ?? 'this assignment'}.`,
      );
    }
    return map;
  }, [ready, state]);

  const tree = useMemo(
    () => buildTree(state.items.filter((i) => i.projectId === projectId)),
    [state.items, projectId],
  );

  const people = useMemo(() => {
    const ids = new Set<EmployeeId>();
    for (const a of state.allocations) {
      const item = state.items.find((i) => i.id === a.breakdownItemId);
      if (item?.projectId === projectId) ids.add(a.employeeId);
    }
    const first = state.rateSnapshot?.employees[0];
    if (first) ids.add(first.id);
    return [...ids]
      .map((id) => employeeById(id))
      .filter((e): e is Employee => Boolean(e))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state, projectId]);

  const rows = useMemo(() => flattenRows(tree, state, people), [tree, state, people]);

  if (error) return <div className="panel error">{error}</div>;
  if (!ready) return <div className="panel muted">Loading delivery plan…</div>;

  return (
    <div className="delivery-app">
      <header className="delivery-header">
        <div>
          <h1>Delivery</h1>
          <p className="muted">
            Work breakdown + staffing grid · rates in EUR · display {currency}
            {user ? ` · ${user.name}` : ''}
            {state.rateSnapshot
              ? ` · rates rev ${state.rateSnapshot.revision}`
              : ' · waiting for rates'}
          </p>
        </div>
        <div className="controls">
          <label>
            Project
            <select
              value={projectId}
              onChange={(e) => setProjectId(asProjectId(e.target.value))}
            >
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Unit
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as DisplayUnit)}
            >
              {(Object.keys(UNIT_LABEL) as DisplayUnit[]).map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                  {u === 'cost' ? ` (${currency})` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ghost"
            title="Restore the shipped plan fixture"
            onClick={() => void resetToSeed()}
          >
            Reset plan
          </button>
        </div>
      </header>

      {message ? (
        <div className="callout">
          {message}{' '}
          <button type="button" className="ghost" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="mobile-tabs" role="tablist" aria-label="Delivery panels">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'wbs'}
          className={mobilePanel === 'wbs' ? 'active' : undefined}
          onClick={() => setMobilePanel('wbs')}
        >
          Breakdown
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'grid'}
          className={mobilePanel === 'grid' ? 'active' : undefined}
          onClick={() => setMobilePanel('grid')}
        >
          Staffing grid
        </button>
      </div>

      <div className="delivery-layout">
        <aside className={`wbs${mobilePanel === 'grid' ? ' mobile-hide' : ''}`}>
          <h2>Work breakdown</h2>
          <WbsTree
            nodes={tree}
            allItems={state.items.filter((i) => i.projectId === projectId)}
            onRename={async (id, name) => renameItem(id, name)}
            onAddChild={async (parentId, name) => {
              const result = await addChild(parentId, name);
              setMessage(
                result.ok
                  ? 'Child added. Leaf allocations on the parent were moved to the new child.'
                  : result.message,
              );
            }}
            onDelete={async (id) => {
              await deleteItem(id);
            }}
            onMove={async (id, newParentId) => {
              const err = await moveItem(id, newParentId);
              if (err) setMessage(err);
            }}
            onAddRoot={async (name) => createRootItem(projectId, name)}
          />
        </aside>

        <section className={`grid-wrap${mobilePanel === 'wbs' ? ' mobile-hide' : ''}`}>
          <div className="grid-scroll">
            <table className="staffing">
              <thead>
                <tr>
                  <th>Work package / person</th>
                  {months.map((m) => (
                    <th key={m}>{formatMonth(m)}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) =>
                  row.kind === 'item' ? (
                    <DerivedRow
                      key={row.item.id}
                      item={row.item}
                      depth={row.depth}
                      months={months}
                      unit={unit}
                      currency={currency}
                      state={state}
                    />
                  ) : (
                    <PersonRow
                      key={`${row.item.id}-${row.employee.id}`}
                      item={row.item}
                      employee={row.employee}
                      months={months}
                      unit={unit}
                      currency={currency}
                      state={state}
                      overByAlloc={overByAlloc}
                      onEdit={setAllocationHours}
                    />
                  ),
                )}
              </tbody>
            </table>
            <p className="muted small">
              Leaf cells editable · parents derived · † over-capacity cause · ○ no rate
              coverage
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function buildTree(items: BreakdownItem[]): TreeNode[] {
  const byParent = new Map<string, BreakdownItem[]>();
  for (const item of items) {
    const key = item.parentId ?? 'root';
    const list = byParent.get(key) ?? [];
    list.push(item);
    byParent.set(key, list);
  }
  const walk = (parentKey: string): TreeNode[] =>
    (byParent.get(parentKey) ?? []).map((item) => ({
      item,
      children: walk(item.id),
    }));
  return walk('root');
}

function flattenRows(
  nodes: TreeNode[],
  state: DeliveryState,
  people: Employee[],
): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      out.push({ kind: 'item', item: node.item, depth });
      if (node.children.length === 0) {
        const assigned = people.filter((p) =>
          state.allocations.some(
            (a) => a.breakdownItemId === node.item.id && a.employeeId === p.id,
          ),
        );
        const listPeople = assigned.length > 0 ? assigned : people.slice(0, 5);
        for (const employee of listPeople) {
          out.push({ kind: 'person', item: node.item, employee, depth: depth + 1 });
        }
      } else {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return out;
}

function WbsTree({
  nodes,
  allItems,
  onRename,
  onAddChild,
  onDelete,
  onMove,
  onAddRoot,
}: {
  nodes: TreeNode[];
  allItems: BreakdownItem[];
  onRename: (id: BreakdownItemId, name: string) => Promise<void>;
  onAddChild: (parentId: BreakdownItemId, name: string) => Promise<void>;
  onDelete: (id: BreakdownItemId) => Promise<void>;
  onMove: (
    id: BreakdownItemId,
    newParentId: BreakdownItemId | null,
  ) => Promise<void>;
  onAddRoot: (name: string) => Promise<void>;
}) {
  const [newRoot, setNewRoot] = useState('');
  return (
    <div>
      <ul className="tree">
        {nodes.map((n) => (
          <WbsNode
            key={n.item.id}
            node={n}
            allItems={allItems}
            onRename={onRename}
            onAddChild={onAddChild}
            onDelete={onDelete}
            onMove={onMove}
          />
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newRoot.trim()) return;
          await onAddRoot(newRoot.trim());
          setNewRoot('');
        }}
      >
        <input
          value={newRoot}
          onChange={(e) => setNewRoot(e.target.value)}
          placeholder="New root item"
        />
        <button type="submit">Add root</button>
      </form>
    </div>
  );
}

function WbsNode({
  node,
  allItems,
  onRename,
  onAddChild,
  onDelete,
  onMove,
}: {
  node: TreeNode;
  allItems: BreakdownItem[];
  onRename: (id: BreakdownItemId, name: string) => Promise<void>;
  onAddChild: (parentId: BreakdownItemId, name: string) => Promise<void>;
  onDelete: (id: BreakdownItemId) => Promise<void>;
  onMove: (
    id: BreakdownItemId,
    newParentId: BreakdownItemId | null,
  ) => Promise<void>;
}) {
  const depth = depthOf(allItems, node.item.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const levelLabel = depth === 0 ? 'root' : depth === 1 ? 'package' : 'leaf';

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  return (
    <li className={`tree-item depth-${depth}`}>
      <div className="tree-row" style={{ paddingLeft: `${0.35 + depth * 0.9}rem` }}>
        <span className="tree-label">
          <span className="tree-guide" aria-hidden="true" />
          <strong title={node.item.name}>{node.item.name}</strong>
          <span className="level-tag">{levelLabel}</span>
        </span>
        <div className="tree-menu">
          <button
            type="button"
            className="menu-trigger"
            aria-label={`Actions for ${node.item.name}`}
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((open) => !open);
            }}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div
              className="menu-pop"
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setMenuOpen(false);
                  const name = window.prompt('Rename', node.item.name);
                  if (name) await onRename(node.item.id, name);
                }}
              >
                Rename
              </button>
              {depth < 2 ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setMenuOpen(false);
                    const name = window.prompt('New child name');
                    if (name) await onAddChild(node.item.id, name);
                  }}
                >
                  Add child
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setMenuOpen(false);
                  const options = allItems
                    .filter((i) => i.id !== node.item.id)
                    .map((i) => `${i.id} — ${i.name}`)
                    .slice(0, 30)
                    .join('\n');
                  const raw = window.prompt(
                    `Move under item id (blank = root):\n${options}`,
                  );
                  if (raw === null) return;
                  await onMove(
                    node.item.id,
                    raw.trim() ? asBreakdownItemId(raw.trim()) : null,
                  );
                }}
              >
                Move
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger-item"
                onClick={async () => {
                  setMenuOpen(false);
                  if (window.confirm(`Delete “${node.item.name}” and descendants?`)) {
                    await onDelete(node.item.id);
                  }
                }}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((c) => (
            <WbsNode
              key={c.item.id}
              node={c}
              allItems={allItems}
              onRename={onRename}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onMove={onMove}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function descendantLeafIds(
  state: DeliveryState,
  itemId: BreakdownItemId,
): BreakdownItemId[] {
  const kids = state.items.filter((i) => i.parentId === itemId);
  if (kids.length === 0) return isLeaf(state.items, itemId) ? [itemId] : [];
  return kids.flatMap((k) => descendantLeafIds(state, k.id));
}

function DerivedRow({
  item,
  depth,
  months,
  unit,
  currency,
  state,
}: {
  item: BreakdownItem;
  depth: number;
  months: YearMonth[];
  unit: DisplayUnit;
  currency: DisplayCurrency;
  state: DeliveryState;
}) {
  const leafIds = descendantLeafIds(state, item.id);
  const exact = months.map((month) => {
    let sum = 0;
    for (const leafId of leafIds) {
      for (const a of state.allocations) {
        if (a.breakdownItemId !== leafId || a.month !== month) continue;
        const emp = employeeById(a.employeeId);
        if (!emp) continue;
        let v = hoursToDisplay(a.amount, unit, {
          weeklyHours: emp.weeklyHours,
          month,
          employeeRates: ratesFor(emp.id),
        });
        if (unit === 'cost') v = fromEur(v, currency);
        sum += v;
      }
    }
    return sum;
  });
  const totalExact = exact.reduce((a, b) => a + b, 0);
  const rounded = largestRemainderRound(exact, DISPLAY_PRECISION[unit]);
  const totalRounded = roundTo(totalExact, DISPLAY_PRECISION[unit]);

  return (
    <tr className="derived">
      <td style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}>
        <span className="derived-label">{item.name}</span>{' '}
        <span className="tag">DERIVED</span>
      </td>
      {rounded.map((v, i) => (
        <td key={months[i]} className="num">
          {formatDisplay(v, unit, currency)}
        </td>
      ))}
      <td className="num total">{formatDisplay(totalRounded, unit, currency)}</td>
    </tr>
  );
}

function PersonRow({
  item,
  employee,
  months,
  unit,
  currency,
  state,
  overByAlloc,
  onEdit,
}: {
  item: BreakdownItem;
  employee: Employee;
  months: YearMonth[];
  unit: DisplayUnit;
  currency: DisplayCurrency;
  state: DeliveryState;
  overByAlloc: Map<AllocationId, string>;
  onEdit: typeof setAllocationHours;
}) {
  const exact = months.map((month) => {
    const alloc = findAllocation(state, item.id, employee.id, month);
    let v = hoursToDisplay(alloc?.amount ?? 0, unit, {
      weeklyHours: employee.weeklyHours,
      month,
      employeeRates: ratesFor(employee.id),
    });
    if (unit === 'cost') v = fromEur(v, currency);
    return v;
  });
  const totalExact = exact.reduce((a, b) => a + b, 0);
  const rounded = largestRemainderRound(exact, DISPLAY_PRECISION[unit]);
  const totalRounded = roundTo(totalExact, DISPLAY_PRECISION[unit]);

  return (
    <tr>
      <td style={{ paddingLeft: '1.5rem' }}>{employee.name}</td>
      {months.map((month, i) => {
        const alloc = findAllocation(state, item.id, employee.id, month);
        const covered = hasRateCoverageForMonth(month, ratesFor(employee.id));
        const cause = alloc ? overByAlloc.get(alloc.id) : undefined;
        return (
          <td key={month} className="num cell">
            <EditableCell
              display={rounded[i]!}
              unit={unit}
              currency={currency}
              noRate={!covered && (alloc?.amount ?? 0) > 0}
              overTitle={cause}
              onCommit={async (displayValue) => {
                const eurValue =
                  unit === 'cost' ? toEur(displayValue, currency) : displayValue;
                const hours = displayToHours(eurValue, unit, {
                  weeklyHours: employee.weeklyHours,
                  month,
                  employeeRates: ratesFor(employee.id),
                });
                await onEdit({
                  breakdownItemId: item.id,
                  employeeId: employee.id,
                  month,
                  hours,
                  existingId: alloc?.id,
                });
              }}
            />
          </td>
        );
      })}
      <td className="num total">{formatDisplay(totalRounded, unit, currency)}</td>
    </tr>
  );
}

function EditableCell({
  display,
  unit,
  currency,
  noRate,
  overTitle,
  onCommit,
}: {
  display: number;
  unit: DisplayUnit;
  currency: DisplayCurrency;
  noRate: boolean;
  overTitle?: string;
  onCommit: (value: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [opened, setOpened] = useState('');

  if (editing) {
    return (
      <input
        className="cell-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          setEditing(false);
          const n = Number(draft);
          if (!Number.isFinite(n)) return;
          // Opening and leaving a cell must not persist the displayed rounding.
          if (draft.trim() === opened) return;
          await onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`cell-btn${overTitle ? ' over' : ''}`}
      title={overTitle}
      onClick={() => {
        setDraft(String(display));
        setOpened(String(display));
        setEditing(true);
      }}
    >
      {formatDisplay(display, unit, currency)}
      {overTitle ? ' †' : ''}
      {noRate ? ' ○' : ''}
    </button>
  );
}

function formatMonth(m: YearMonth): string {
  const [, mo] = m.split('-');
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${names[Number(mo) - 1]} ${m.slice(2, 4)}`;
}

function formatDisplay(
  value: number,
  unit: DisplayUnit,
  currency: DisplayCurrency,
): string {
  const p = DISPLAY_PRECISION[unit];
  const n = roundTo(value, p).toFixed(p);
  if (unit === 'cost') {
    return `${currencySymbol(currency)}${n}`;
  }
  if (unit === 'percent') return `${n}%`;
  return n;
}
