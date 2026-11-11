---
name: clause-clock
description: Use when evaluating or settling a Jira Service Management (JSM) SLA Service Credit claim across overlapping incidents, maintenance windows, billing timezones, monthly credit caps, and upstream vendor outage feeds, or when running the ClauseClock PBT invariant audit. Do not use for single-ticket first-response SLA timers, live bank wire transfers, or unstructured PDF/Word OCR.
allowed-tools: evaluate-clause-clock run-pbt-audit commit-credit-settlement reset-settlement-state
---

# ClauseClock — SLA Interval Splicer & Vendor Recovery (`clause-clock`)

Use this skill whenever an operator, finance controller, or SRE needs to evaluate a Jira Service Management (JSM) SLA Service Credit claim across multiple overlapping incidents, scheduled maintenance exclusions, timezone-aligned billing months, monthly credit caps, and upstream vendor outage windows.

## Mandatory Execution Discipline

1. **Zero LLM Math**: Never sum incident durations or calculate credit percentages in free-form text. Always call `evaluate-clause-clock` first to run the deterministic integer-minute sweep-line (`NetOutage = (Union(Incidents) ∩ BillingWindow) \ Union(Maintenance)`) and Largest-Remainder cent apportionment engine.
2. **Contract Fee Lock**: Never pass AI-guessed `monthlyFeeCents`, `newCreditCents`, or `creditBps` overrides as authoritative values; `ClauseClock` locks monetary figures to structured contract JSON and logs any override attempt in `discardedAiAmountOverrides`.
3. **Two-Phase Human Approval & Version Binding**:
   - Before calling `commit-credit-settlement`, present the `proposalVersionKey` (`CCLOCK-<claimKey>-<YYYY-MM>-NET<M>M-CRED<cents>-VEND<cents>`) and ask the human approver for confirmation.
   - Require an explicit `APPROVAL::<proposalVersionKey>::<approverId>` token.
   - If the contract is in `DRAFT` status (`provisionalDraftMode: true`), require an explicit `financeOverrideReason`.
4. **Mandatory Machine-Readable Receipt Footer**: Every response must end with the verbatim footer returned by the tool:
   `[ClauseClock Receipt #<receiptId> | issue=<key> | month=<YYYY-MM> (<tz>) | mode=<LIVE|SEEDED> | netOutage=<M>m | credit=$<X> | vendorSplit=<summary>]`

## Tool Reference

- `evaluate-clause-clock` (`GET`): Evaluates a seeded or live JSM claim (`hero-overlap-splicer`, `cross-timezone-boundary`, `monthly-cap-truncation`, `unapproved-contract-draft`) and returns `CalculationReceipt`, `SourceProvenanceManifest`, `approvalTokenTemplate`, and `machineReadableFooter`.
- `run-pbt-audit` (`GET`): Runs `fast-check` Property-Based Testing across invariants `P1` (Bitmap Oracle Interval Equivalence), `P2` (Monotonicity & Cap Lock), `P3` (Vendor Cent Conservation), and `P4` (Idempotent Commit & Reset Round-Trip).
- `commit-credit-settlement` (`CREATE`): Validates `expectedProposalVersionKey` (`409` on TOCTOU drift) and `approvalToken` (`400` on missing/invalid token or unapproved draft), saves the `(customerId, billingMonth)` cap ledger and pending delivery atomically in KVS, then writes the JSM internal note and Jira Entity Property and publishes a realtime refresh. A delivery failure returns `PENDING_RETRY`; retry the action before treating external delivery as complete.
- `reset-settlement-state` (`UPDATE`): Restores the claim and `(customerId, billingMonth)` cap ledger to `READY` so demos and audits can be re-run cleanly.
