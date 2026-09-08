import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type {
  Employee,
  EmployeeId,
  IsoDate,
  OverCapacityDetail,
  RateRecord,
  ShellRuntimeProps,
} from '@baseline/contracts';
import { asIsoDate, asRateRecordId, getBus } from '@baseline/contracts';
import { currencySymbol, fromEur, roundTo, sortRates, toEur } from '@baseline/domain';
import {
  getPeopleState,
  initPeopleStore,
  removeRate,
  subscribePeople,
  upsertRate,
  type PeopleState,
} from './store';
import './styles.css';

export interface PeopleAppProps {
  currency?: ShellRuntimeProps['currency'];
  user?: ShellRuntimeProps['user'];
}

const emptyState: PeopleState = { employees: [], rates: [], revision: 0 };

export default function PeopleApp({ currency = 'EUR', user }: PeopleAppProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<EmployeeId | null>(null);
  const [overCapacity, setOverCapacity] = useState<OverCapacityDetail[]>([]);

  const state = useSyncExternalStore(
    subscribePeople,
    () => (ready ? getPeopleState() : emptyState),
    () => emptyState,
  );

  useEffect(() => {
    initPeopleStore()
      .then(() => setReady(true))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Failed to load people store'),
      );
  }, []);

  useEffect(() => {
    return getBus().on('baseline:over-capacity', (detail) => {
      setOverCapacity(detail);
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.employees;
    return state.employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q),
    );
  }, [state.employees, query]);

  const selected = state.employees.find((e) => e.id === selectedId) ?? null;
  const selectedRates = sortRates(
    state.rates.filter((r) => r.employeeId === selectedId),
  );
  const overIds = new Set(overCapacity.map((o) => o.employeeId));

  if (error) {
    return <div className="panel error">{error}</div>;
  }
  if (!ready) {
    return <div className="panel muted">Loading people register…</div>;
  }

  return (
    <div className="people-app">
      <header className="people-header">
        <div>
          <h1>People</h1>
          <p className="muted">
            Employee register · rates stored in EUR · display {currency}
            {user ? ` · ${user.name}` : ''}
          </p>
        </div>
        <label className="search">
          <span className="sr-only">Search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, role, id…"
          />
        </label>
      </header>

      <div className="people-layout">
        <aside className="register">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>h/w</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr
                  key={emp.id}
                  className={emp.id === selectedId ? 'selected' : undefined}
                  onClick={() => setSelectedId(emp.id)}
                >
                  <td>{emp.name}</td>
                  <td>{emp.role}</td>
                  <td>{emp.weeklyHours}</td>
                  <td>
                    {overIds.has(emp.id) ? (
                      <span
                        className="badge over"
                        title="Over capacity in one or more months"
                      >
                        over
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>

        <section className="detail">
          {selected ? (
            <RateEditor
              employee={selected}
              rates={selectedRates}
              currency={currency}
              overMonths={overCapacity.filter((o) => o.employeeId === selected.id)}
              onSave={async (input) => {
                await upsertRate(selected.id, input);
              }}
              onRemove={async (rateId) => {
                await removeRate(asRateRecordId(rateId));
              }}
            />
          ) : (
            <p className="muted">Select an employee to edit rate history.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function RateEditor({
  employee,
  rates,
  currency,
  overMonths,
  onSave,
  onRemove,
}: {
  employee: Employee;
  rates: RateRecord[];
  currency: ShellRuntimeProps['currency'];
  overMonths: OverCapacityDetail[];
  onSave: (input: {
    id?: RateRecord['id'];
    validFrom: IsoDate;
    hourlyCost: number;
  }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [validFrom, setValidFrom] = useState('2026-03-12');
  const [hourlyCost, setHourlyCost] = useState('95.00');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const symbol = currencySymbol(currency);

  return (
    <div>
      <h2>{employee.name}</h2>
      <p className="muted">
        {employee.role} · {employee.weeklyHours} h/week · {employee.id}
      </p>

      {overMonths.length > 0 ? (
        <div className="callout warn">
          Oversubscribed in {overMonths.map((o) => o.month).join(', ')}{' '}
          (cross-project capacity).
        </div>
      ) : null}

      <h3>Rate history</h3>
      <p className="muted small">
        Stored in EUR; shown in {currency}. Edits are entered in {currency} and converted
        back to EUR. A rate runs from <code>validFrom</code> (inclusive) until the next one.
      </p>

      <table className="rates">
        <thead>
          <tr>
            <th>Valid from</th>
            <th>Hourly cost ({currency})</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rates.map((rate) => {
            const displayCost = roundTo(fromEur(rate.hourlyCost, currency), 2);
            return (
              <tr key={rate.id}>
                <td>
                  {editingId === rate.id ? (
                    <input
                      type="date"
                      value={validFrom}
                      onChange={(e) => setValidFrom(e.target.value)}
                    />
                  ) : (
                    rate.validFrom
                  )}
                </td>
                <td>
                  {editingId === rate.id ? (
                    <input
                      value={hourlyCost}
                      onChange={(e) => setHourlyCost(e.target.value)}
                      inputMode="decimal"
                    />
                  ) : (
                    `${symbol}${displayCost.toFixed(2)}`
                  )}
                </td>
                <td className="actions">
                  {editingId === rate.id ? (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          await onSave({
                            id: rate.id,
                            validFrom: asIsoDate(validFrom),
                            hourlyCost: toEur(Number(hourlyCost), currency),
                          });
                          setEditingId(null);
                          setMessage('Rate updated — Delivery notified.');
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setEditingId(rate.id);
                          setValidFrom(rate.validFrom);
                          setHourlyCost(String(displayCost));
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger ghost"
                        onClick={async () => {
                          await onRemove(rate.id);
                          setMessage('Rate removed.');
                        }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <form
        className="add-rate"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave({
            validFrom: asIsoDate(validFrom),
            hourlyCost: toEur(Number(hourlyCost), currency),
          });
          setMessage('Rate added — Delivery notified.');
        }}
      >
        <h3>Add rate</h3>
        <label>
          Valid from
          <input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            required
          />
        </label>
        <label>
          Hourly cost ({currency})
          <input
            value={hourlyCost}
            onChange={(e) => setHourlyCost(e.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <button type="submit">Add rate</button>
      </form>

      {message ? <p className="ok">{message}</p> : null}
    </div>
  );
}
