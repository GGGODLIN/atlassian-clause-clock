# 01 — Deterministic Interval Algebra, Largest-Remainder Vendor Apportionment, 4 Seeded Scenarios & 3-Role PBT Engine

**What to build:** Build the pure-TypeScript deterministic SLA credit and upstream vendor penalty apportionment engine (`reconcileClauseClock`), the 4 canonical seeded demo scenarios, the self-contained `CalculationReceipt` + `SourceProvenanceManifest` generator, and the 3-role `fast-check` Property-Based Testing auditor (`runClauseClockPbtAudit`) backed by an independent minute-by-minute `Uint8Array(44640)` discrete bitmap oracle.

**Blocked by:** None — can start immediately

**Status:** `done`

**Needs:** None — a worker can check every item unaided

**Validation method:** Run `node --experimental-strip-types --test tests/ticket-01-interval-engine-and-pbt.test.ts`

**Evidence required:** Exit code `0` with all Role 1 (concrete scenarios & edge cases), Role 2 (`fc.property` invariants `P1..P3` + non-zero `reachabilityWitnesses`), and Role 3 (independent oracle calibration & naive-spreadsheet counterexample replay) assertions passing.

**Tests:** `required`

**Test seam:** `reconcileClauseClock(scenario, options)` and `runClauseClockPbtAudit(options)`

**Regression scope:** Preserves `Story 1`, `Story 3`, `Story 5`, and `Story 6`, plus Conditional PBT invariants `P1` (Interval Algebra Equivalence, Commutativity, Idempotence & Split-Invariance against the independent `Uint8Array(44640)` minute-bitmap oracle within billing month domain `[0, 44640]`), `P2` (Monotonicity, Contract Fee Lock & Monthly Cap Bound `0 <= newCreditCents <= Math.max(0, monthlyCapCents - priorApprovedCents)`), and `P3` (Vendor Apportionment Cent Conservation via Largest Remainder Method `sum(vendorApportionedCents) + internalAbsorbedCents === newCreditCents`).

- [x] `reconcileClauseClock` normalizes incident, maintenance, and upstream vendor windows into half-open integer-minute intervals clipped to the contract's timezone-aligned billing month window, folds overlapping incidents (`mergeIntervals`), subtracts maintenance exclusions (`subtractIntervals`), and computes the hero scenario (`[60m, 60m]` overlapping by `30m` -> `90m` union minus `15m` maintenance = `75m` net billable downtime, `99.8264%` uptime on a 30-day `43,200m` month, `10%` tier on `$20,000` monthly fee = `$2,000` gross credit minus `$500` prior approved = `$1,500` (`150000` cents) net credit, split `60% / 40%` into `$900` (`90000` cents) upstream vendor recovery and `$600` (`60000` cents) internal absorption) — Source: Story 1
- [x] Every calculation emits a self-contained `CalculationReceipt` (with `inputsSnapshot`, step-by-step `intervalLedger`, `mathBreakdown`, and a copy-pasteable `replayCommand`), a `SourceProvenanceManifest`, and a human-readable `proposalVersionKey` (`CCLOCK-${claimKey}-${billingMonth}-NET${netMinutes}M-CRED${newCreditCents}-VEND${vendorTotalCents}`, with zero SHA-256/MD5 hashing) — Source: Story 3 & Story 5
- [x] When an AI caller or external payload supplies custom fee or credit amount overrides, `reconcileClauseClock` ignores them, computes amounts strictly from the locked contract JSON, and records the rejected overrides in `discardedAiAmountOverrides` — Source: Story 3 — Failure: F2
- [x] Missing contract timezone defaults deterministically to `UTC` while flagging `missingTimezoneFallback: true` and reporting cross-month boundary sensitivity; unapproved (`DRAFT`) contracts compute a full preview receipt with `provisionalDraftMode: true` — Source: Story 1 & Story 5 — Failure: F2
- [x] Boundary cases (zero incidents, 100% maintenance-covered incidents, `priorApprovedCents >= monthlyCapCents` capping `newCreditCents` to `0`, and multi-vendor equal-overlap remainder ties) resolve deterministically without `NaN` or cent drift — Source: Story 1 — Failure: F6
- [x] `runClauseClockPbtAudit` executes Role 1 concrete checks, Role 2 `fc.property` checks for `P1..P3` against the independent `Uint8Array(44640)` minute-bitmap oracle (asserting aggregate `reachabilityWitnesses`: `overlapFoldedCount > 0`, `maintenanceDeductedCount > 0`, `capTruncatedCount > 0`, `multiVendorSplitCount > 0`), and Role 3 individual oracle calibration (`P1`, `P2`, `P3` each independently tripped by test-local mutations) plus deterministic counterexample replay comparing naive spreadsheet addition (`120m -> $5,000`) against `ClauseClock` (`75m -> $1,500`) — Source: Story 6

## Verification Log

- 2026-11-06 Batch Execution & Testing Mode Approved: `execution_mode=subagent-driven` (`1.b`), `testing_mode=tdd` (`2.a`), `ticket_01_best_of_n=enabled` (`3.a`), covering Tickets `01`, `02`, `03` (`[user: "1.b\n2.a\n3.a"]`).
- 2026-11-06 Ticket 01 Completed (`best-of-n-implement` `wf_e3894023-966` winner `bon-2` + YAGNI trim): `node --experimental-strip-types --test tests/ticket-01-interval-engine-and-pbt.test.ts` (7/7 pass) & `npx tsc --noEmit` (exit 0).
- 2026-11-06 Closeout Review (`typescript-reviewer` + `security-reviewer`):
  - `Acceptance-miss — P1 independent oracle boundary → checkP1IntervalEquivalence passed clippedIncidents/clippedMaintenance instead of raw scenario intervals and omitted vendorCoveredUnionMinutes / vendorOverlapMinutesByVendorId checks` (FIXED in `src/core/clause-clock-pbt.ts`).
  - `Failure-miss: F5 — replayCommand omitted disabledIncidentIds/disabledMaintenanceIds and unvalidated timezoneOverride could break footer/replayCommand` (FIXED in `src/core/clause-clock-engine.ts` via `isValidIanaTimezone` and `JSON.stringify` replay options).
  - `Failure-miss: F2 — timezone offset subtraction direction in Scenario 2` (Kept per `M3` / `choices.md` `D20` `needs-user`: Scenario 2 test and UI copy intentionally pin the `40m -> 60m` shift; `isValidIanaTimezone` added so invalid timezones never silently pass).
  - `Failure-miss: F6 — capTruncated boundary step when grossCreditCents === remainingCapBeforeCents` (Kept per `M3`: existing formula is pinned by Scenario 1 `$2,000 - $500 = $1,500` and Scenario 3 `$3,000 capped to $800` contract tests).
