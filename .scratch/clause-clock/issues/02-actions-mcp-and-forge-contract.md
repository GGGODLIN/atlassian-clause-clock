# 02 — Unified 4-Action Dispatcher, Two-Phase Human Approval Gate, Cap Ledger, 1-Click Reset & Forge Contract Integration

**What to build:** Build the unified 4-action contract registry and dispatcher (`executeClauseClockAction` handling `evaluate-clause-clock`, `run-pbt-audit`, `commit-credit-settlement`, and `reset-settlement-state`), the human approval token & `proposalVersionKey` TOCTOU gate, the `(customerId, billingMonth)` cap ledger with idempotent replay and 1-click rollback, the single-page read-only Teamwork Graph + pruned Jira REST + seeded fallback context adapter, the `@forge/realtime` publisher, the Forge `manifest.yml` (`jira:issuePanel`, `jira:globalPage`, `rovo:agent`, `rovo:skill`, `rovo:mcp`, `action`, single `function` router), the open-source `skills/clause-clock/SKILL.md`, and Next.js `/api/clause-clock` + `/api/mcp` HTTP endpoints.

**Blocked by:** 01 — Deterministic Interval Algebra, Largest-Remainder Vendor Apportionment, 4 Seeded Scenarios & 3-Role PBT Engine

**Status:** `done`

**Needs:** None — a worker can check every item unaided

**Validation method:** Run `node --experimental-strip-types --test tests/ticket-02-actions-mcp-and-forge-contract.test.ts`

**Evidence required:** Exit code `0` verifying all 4 actions, `400`/`409` approval & TOCTOU rejections, `P4` idempotent commit & reset round-trip, machine-readable receipt footers, and static contract alignment across `manifest.yml`, `skills/clause-clock/SKILL.md`, and TypeScript action schemas.

**Tests:** `required`

**Test seam:** `executeClauseClockAction(store, actionKey, payload)`, `/api/clause-clock`, `/api/mcp`, and `validateForgeManifestAndSkillContract()`

**Regression scope:** Preserves `Story 2`, `Story 3`, `Story 4`, and `Story 5`, plus Conditional PBT invariant `P4` (Idempotent Commit & Reset Round-Trip) and Ticket `01` interval/cent invariants.

- [x] `executeClauseClockAction` routes all 4 actions (`evaluate-clause-clock`, `run-pbt-audit`, `commit-credit-settlement`, `reset-settlement-state`) and appends the mandatory machine-readable receipt footer `[ClauseClock Receipt #<receiptId> | issue=<key> | month=<YYYY-MM> (<tz>) | mode=<LIVE|SEEDED> | netOutage=<M>m | credit=$<X> | vendorSplit=<summary>]` to every Rovo/MCP output — Source: Story 5 — Failure: F5
- [x] `commit-credit-settlement` rejects requests missing a valid `APPROVAL::${proposalVersionKey}::${approverId}` token (`400 MISSING_HUMAN_APPROVAL_TOKEN`), requests against an unapproved `DRAFT` contract without `financeOverrideReason` (`400 UNAPPROVED_CONTRACT_DRAFT`), and requests whose `expectedProposalVersionKey` no longer matches the current underlying scenario state (`409 STALE_PROPOSAL_VERSION_KEY`), performing zero state mutations on rejection — Source: Story 4 — Failure: F1
- [x] On valid approval, `commit-credit-settlement` atomically updates the `(customerId, billingMonth)` cap ledger, records the JSM internal note, Jira Entity Property, and KVS settlement record, emits a `@forge/realtime` event payload, and returns `idempotentReplay: true` without double-deducting the monthly cap when called repeatedly with the same `proposalVersionKey`; calling `reset-settlement-state` cleanly restores the pre-settlement `READY` state and monthly cap balance (`P4`) — Source: Story 4 — Failure: F1
- [x] Unknown action names or malformed/non-object input payloads fail closed with HTTP `400` and a structured error code without throwing unhandled exceptions or leaking internal stack traces — Source: Story 4 — Failure: F2
- [x] When Teamwork Graph or Jira REST credentials/links are absent or fail, the context loader falls back deterministically to the requested seeded scenario, populates `SourceProvenanceManifest` with `sourceMode: "SEEDED_FIXTURE"` and `fallbackReason`, and enforces `first <= 25` and User-field pruning on live query builders — Source: Story 2 & Story 5 — Failure: F4
- [x] `validateForgeManifestAndSkillContract()` verifies that `manifest.yml` declares `jira:issuePanel`, `jira:globalPage`, `rovo:agent`, `rovo:skill`, `rovo:mcp`, and the 4 `action` entries routed to a single `function` handler (with zero `graph:connector`), and that `skills/clause-clock/SKILL.md` frontmatter has `name: clause-clock` and `allowed-tools` matching the exact 4 action keys — Source: Story 2 & Story 3 — Failure: F3

## Verification Log

- 2026-11-06 Ticket 02 Completed (`routed-impl` worker `a346d1b10118120df` in `.worktrees/ticket-02`): `node --experimental-strip-types --test tests/ticket-01-interval-engine-and-pbt.test.ts tests/ticket-02-actions-mcp-and-forge-contract.test.ts` (15/15 pass, Role 1..3 + `P4`) and `npx tsc --noEmit` (exit 0).
- 2026-11-06 `ticket-yagni` hook runner note: `Unreviewed: no registered absolute ticket path for this worker; the runner does not scan directories` (recorded per `/implement` Step 2.3 without retrying with different arguments).
