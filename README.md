# Baseline Planning Suite

Senior Frontend Engineer case study for innoscripta — three Module Federation apps that plan who works on what, for how long, and what it costs.

## Quick start

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). No Node on the host is required.

If Docker Desktop is not running and you already have a local build:

```bash
npm install && npm run generate:seed && npm run build && npm run serve:local
```

### Back to the fixture

Each remote owns a reset for its own data: **Reset rates** in the People header, **Reset plan** in the Delivery header. Edits persist in IndexedDB, so this is how you get back to the shipped seed — and back to the R1 reference numbers — after typing test values in.

### Break a remote on purpose

In the shell header, set **Break remote** to `People` or `Delivery`. That points the runtime loader at a missing `remoteEntry.BROKEN.js`. The shell stays up and shows an in-place fallback for that panel.

Alternatively edit `/config.json` (served by nginx) and change a remote URL, then click **Reload config**.

### Local development (optional)

```bash
npm install
npm run generate:seed
npm run test
npm run typecheck                  # strict, no `any`, across all five packages
npm run dev -w @baseline/people    # :3001
npm run dev -w @baseline/delivery  # :3002
npm run dev -w @baseline/shell     # :3000 — set config remotes to localhost ports
```

---

## Repo map

```
apps/
  shell/       Host — navigation, currency, active user, runtime remote loader
  people/      Remote — employee register + rate history (SoT for rates)
  delivery/    Remote — WBS + staffing grid (SoT for plan/allocations)
packages/
  contracts/   Published types + BaselineBus event contract
  domain/      Pure calculation engine (no React) + Vitest reference tests
seed/
  seed.json    Fixture data (generated; fixed IDs incl. A. Okafor)
nginx/         Gateway routing + /config.json
Dockerfile     One-command production build
```

Two product teams never import each other's **app** source. They only share `contracts` and `domain` — the published boundary.

---

## Architecture decisions

### Canonical unit: hours

`Allocation.amount` is always hours. Person-months, % of capacity, and cost are conversions at the UI edge (`hoursToDisplay` / `displayToHours`). One person-month = `weeklyHours × (workingDaysInMonth / 5)` — varies by person and month.

### Display currency

`RateRecord.hourlyCost` is stored in EUR — one currency in the data, like one unit in the data. The shell's display currency is applied at the same edge as the unit conversions (`fromEur` / `toEur` in `@baseline/domain`), so switching currency never rewrites stored rates or allocations. People shows and accepts rate edits in the active currency and converts back to EUR before saving. FX rates are fixed constants for the exercise, not a live feed.

### Who computes cost?

**Delivery computes cost** from rate records People publishes.

People remains the source of truth for employees and rates. On every rate change it emits `baseline:rates-changed` with a `RateSnapshot`. Delivery keeps a cache of that snapshot (seeded for standalone) and prices cells locally with `@baseline/domain`.

**Why not ask People for each cell's cost?** The grid has hundreds of cells and derived rollups; a cross-remote RPC per paint would couple latency and release of the two apps. Pricing a plan is Delivery's job; rate *data* ownership stays with People. The splitting formula lives in the published `domain` package so it cannot drift between a People RPC and Delivery's display.

### Transport

`BaselineBus` (`packages/contracts`): in-window handlers + `BroadcastChannel` + `CustomEvent`. Federated remotes share one JS realm; the channel also covers multiple tabs.

Events are fire-and-forget with no retained last value, so a listener only hears what is published while it is subscribed. The shell therefore keeps **both remotes mounted** and lets navigation change which panel is visible. A rate edited in People reaches the Delivery cost view immediately, and Delivery's over-capacity set reaches People, without either app polling or reloading.

| Event | Direction | Payload |
|-------|-----------|---------|
| `baseline:rates-changed` | People → * | `RateSnapshot` |
| `baseline:rates-request` | Delivery → People | refresh ask |
| `baseline:over-capacity` | Delivery → * | per person-month overages |
| `baseline:allocation-edited` | Delivery → * | edit metadata |
| `baseline:shell-context` | Shell → * | currency + user |

### Persistence

IndexedDB per remote (`baseline-people`, `baseline-delivery`). First visit hydrates from `seed/seed.json`. Edits survive reload. No backend service — fits static Docker/nginx hosting.

### Module Federation

- Bundler: **Vite** + `@originjs/vite-plugin-federation`
- React 18 is a **singleton** shared dependency
- Shell does **not** bake remote URLs into the bundle — it loads `/config.json` at runtime and fetches `remoteEntry.js` dynamically (`apps/shell/src/loadRemote.ts`)
- Each remote is one codebase / one build for **standalone** (`main.tsx`) and **hosted** (`exposes: { './App' }`)

### Parent / child WBS rule (R4)

Adding a child under a leaf **moves** that leaf's allocations onto the new child. Silent loss is impossible; the UI explains the move.

### Capacity (R5)

Capacity is 100% of that person's person-month hours, summed **across every project**. Over-capacity is flagged († on the causing allocation — most recently edited), never blocked. People listens to `baseline:over-capacity` and badges oversubscribed employees.

---

## Reference calculation (R1)

A. Okafor · 40 h/week · €80 from 2025-01-01 · €95 from 2026-03-12 · 0.50 PM in March 2026:

| Metric | Value |
|--------|------:|
| Working days | 22 |
| Before 12 Mar | 8 |
| From 12 Mar | 14 |
| Person-month hours | 176 |
| Allocation hours | 88 |
| Cost | **€7,880.00** |
| % capacity | 50.0% |
| Blended rate | €89.5455/h |

Defended by `packages/domain/src/__tests__/reference.test.ts` (runs in CI/Docker build, no browser).

---

## Seed counts

| Entity | Count |
|--------|------:|
| Employees | 60 |
| Rate records | 150 |
| Mid-month rate changes | 10 |
| Projects | 4 |
| Breakdown items | 90 |
| Allocations (editable cells) | 720 |
