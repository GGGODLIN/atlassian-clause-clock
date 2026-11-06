# 03 — Shared `_studio` 5-Track Timeline Splicer Workbench, 3-Minute Judge Rail, MCP Inspector & Dual-View Realtime Preview

**What to build:** Build the shared client-side React workbench (`app/_studio/`) driven by `ClauseClockHostPort` so both the standalone Next.js Web Studio and the Forge Custom UI bundle (`jira:issuePanel` / `jira:globalPage`) render the 5-track interval waterfall, the 1-Click Seed 4-Scenario switcher, the 3-Minute Codegeist Judge Checklist Bar, inline edge-case banners (timezone toggle, draft contract watermark, monthly cap badge), dry-run writeback preview + human approval switch + 1-Click Reset, 3 one-click Markdown receipt exporters, split-view `@forge/realtime` broadcast preview, and embedded Rovo MCP & `SKILL.md` Live Inspector.

**Blocked by:** 01 — Deterministic Interval Algebra, Largest-Remainder Vendor Apportionment, 4 Seeded Scenarios & 3-Role PBT Engine, 02 — Unified 4-Action Dispatcher, Two-Phase Human Approval Gate, Cap Ledger, 1-Click Reset & Forge Contract Integration

**Status:** `ready-for-agent`

**Needs:** None — a worker can check every item unaided

**Validation method:** Run `node --experimental-strip-types --test tests/ticket-03-studio-workbench-ui.test.ts` and `npm run build`

**Evidence required:** Exit code `0` on `tests/ticket-03-studio-workbench-ui.test.ts` and `npm run build` (plus `npx -y react-doctor@latest . --verbose` score `>= 90/100`).

**Tests:** `required`

**Test seam:** Workbench state controller, `ClauseClockHostPort` adapter, and UI contract (`data-testid` attributes and production build)

**Regression scope:** Preserves `Story 1` through `Story 6` and all Ticket `01` & Ticket `02` tests.

- [ ] The workbench renders the 3-Minute Judge Guided Checklist Bar, the 1-Click Seed 4-Scenario selector, the 5-Track Interval Waterfall (Raw Incidents → Merged Union → Maintenance Deduction → Customer Net Outage → Vendor Overlap Slices alongside the Naive Spreadsheet comparison), and the Upstream Vendor Apportionment table — Source: Story 1 & Story 2
- [ ] Switching scenarios, toggling the inline billing timezone (`UTC` vs. contract timezone), or editing interval/maintenance toggles immediately clears any prior human approval checkbox, recomputes the fresh `proposalVersionKey` via the shared core engine, and clears stale error banners — Source: Story 1 & Story 4 — Failure: F1
- [ ] The workbench surfaces explicit edge-case banners for Missing Timezone (with inline timezone switcher), Unapproved Contract (`Provisional Draft Mode` locking commit until Finance Override is provided), and Monthly Cap Truncation (`Uncapped vs. Capped` badge), plus 3 one-click Markdown copy actions (`Copy Customer Credit Receipt`, `Copy Vendor Recovery Claim`, `Copy Confluence Ledger Row`) — Source: Story 2 & Story 3
- [ ] Confirming a settlement in the Support view updates both the Support panel and the companion Finance `@forge/realtime` split-view subscriber with the new `CalculationReceipt` and `SETTLED` status, and clicking `Reset Demo Write-Back` restores the `READY` state across both views — Source: Story 2 & Story 4 — Failure: F5
- [ ] The embedded `Rovo MCP & SKILL.md Live Inspector` displays the live `skills/clause-clock/SKILL.md` contract and executes all 4 MCP tools against the shared store with visible JSON request/response receipts and machine-readable footers — Source: Story 2 & Story 5
