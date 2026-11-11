import type { SettlementStatus } from '../../src/actions/clause-clock-store.ts';
import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';
import {
  formatBillingRange,
  formatBps,
  formatMinutes,
  formatUsdCents,
} from './format.ts';

export type ReceiptExportKind =
  | 'customer-credit-receipt'
  | 'vendor-recovery-claim'
  | 'confluence-ledger-row';

export interface ReceiptExportDescriptor {
  kind: ReceiptExportKind;
  label: string;
  audience: string;
}

export const RECEIPT_EXPORTS: readonly ReceiptExportDescriptor[] = [
  {
    kind: 'customer-credit-receipt',
    label: 'Copy Customer Credit Receipt',
    audience: 'Customer-facing · vendor figures withheld',
  },
  {
    kind: 'vendor-recovery-claim',
    label: 'Copy Vendor Recovery Claim',
    audience: 'Upstream vendors · overlap evidence per vendor',
  },
  {
    kind: 'confluence-ledger-row',
    label: 'Copy Confluence Ledger Row',
    audience: 'Finance ledger · full internal figures',
  },
];

function referenceLine(receipt: CalculationReceipt): string {
  return `Reference: ClauseClock receipt \`${receipt.receiptId}\` · billing month ${receipt.billingMonth} (${receipt.billingTimezone})`;
}

function settlementLabel(status: SettlementStatus): string {
  return status === 'SETTLED' ? 'Settled' : 'Proposed — awaiting human-approved settlement';
}

function capRows(receipt: CalculationReceipt): string[] {
  const math = receipt.mathBreakdown;
  if (math.capTruncated) {
    return [
      `| Monthly credit cap | ${formatUsdCents(receipt.inputsSnapshot.monthlyCapCents)} |`,
      `| Credits already approved this month | ${formatUsdCents(math.priorApprovedCents)} |`,
      `| Cap remaining for this claim | ${formatUsdCents(math.remainingCapBeforeCents)} |`,
      `| Cap truncation | Uncapped ${formatUsdCents(math.uncappedAvailableCreditCents)} → capped ${formatUsdCents(math.newCreditCents)} |`,
    ];
  }
  if (math.priorApprovedCents > 0) {
    return [`| Credits already approved this month | −${formatUsdCents(math.priorApprovedCents)} |`];
  }
  return [];
}

// Vendor recovery figures and the proposal key (which embeds VEND cents) stay out of this customer-facing document.
function customerCreditReceipt(receipt: CalculationReceipt, status: SettlementStatus): string {
  const math = receipt.mathBreakdown;
  return [
    `## SLA Service Credit Receipt · ${receipt.claimKey}`,
    '',
    `**Customer:** ${receipt.customerName} (\`${receipt.customerId}\`)  `,
    `**Contract:** \`${receipt.provenance.contractId}\` · [governing clause](${receipt.provenance.confluenceContractUrl})  `,
    `**Billing month:** ${receipt.billingMonth} (${receipt.billingTimezone})  `,
    `**Status:** ${settlementLabel(status)}${receipt.provisionalDraftMode ? ' · contract terms still in DRAFT' : ''}`,
    '',
    '| Measure | Value |',
    '| --- | ---: |',
    `| Reported incident time (raw sum) | ${formatMinutes(receipt.naiveComparison.rawIncidentSumMinutes)} |`,
    `| Overlapping incidents folded (union) | ${formatMinutes(math.mergedIncidentMinutes)} |`,
    `| Scheduled maintenance excluded | −${formatMinutes(math.maintenanceDeductedMinutes)} |`,
    `| **Net billable outage** | **${formatMinutes(math.netOutageMinutes)}** |`,
    `| Monthly uptime | ${math.uptimePercentage.toFixed(4)}% |`,
    `| SLA credit tier | ${math.matchedTier.label} |`,
    `| Gross service credit (${formatBps(math.matchedTier.creditBps)} of ${formatUsdCents(receipt.inputsSnapshot.monthlyFeeCents)}) | ${formatUsdCents(math.grossCreditCents)} |`,
    ...capRows(receipt),
    `| **Service credit issued** | **${formatUsdCents(math.newCreditCents)}** |`,
    '',
    referenceLine(receipt),
  ].join('\n');
}

// This export groups every vendor's claim; internal absorption figures stay in the finance ledger.
function vendorRecoveryClaim(receipt: CalculationReceipt): string {
  const math = receipt.mathBreakdown;
  const vendorSections = receipt.vendorApportionments.flatMap((vendor) => {
    const windows =
      vendor.overlapIntervals.length > 0
        ? vendor.overlapIntervals
            .map((interval) => formatBillingRange(receipt.billingMonth, interval.startMinute, interval.endMinute, receipt.billingTimezone))
            .join(', ')
        : 'none';
    return [
      `### ${vendor.vendorName} (\`${vendor.vendorId}\` · \`${vendor.componentKey}\`)`,
      `- Overlap with net billable outage: ${formatMinutes(vendor.overlapMinutes)} (${formatBps(vendor.shareBps)} of the credit basis)`,
      `- Overlap windows (${receipt.billingTimezone}): ${windows}`,
      `- **Recovery claimed: ${formatUsdCents(vendor.apportionedCents)}** (${vendor.apportionedCents} cents)`,
      '',
    ];
  });

  return [
    `## Upstream Vendor Recovery Claim · ${receipt.claimKey}`,
    '',
    `**Customer impact:** ${receipt.customerName} · billing month ${receipt.billingMonth} (${receipt.billingTimezone})  `,
    `**Net billable outage:** ${formatMinutes(math.netOutageMinutes)} · **Service credit issued to customer:** ${formatUsdCents(math.newCreditCents)}  `,
    '**Method:** integer-minute overlap against the net billable outage; integer cents split by the Largest Remainder Method',
    '',
    ...(vendorSections.length > 0
      ? vendorSections
      : ['No upstream vendor outage window overlaps the net billable outage; no recovery is claimed.', '']),
    referenceLine(receipt),
  ].join('\n');
}

function confluenceLedgerRow(receipt: CalculationReceipt, status: SettlementStatus): string {
  const math = receipt.mathBreakdown;
  const vendorSplit =
    receipt.vendorApportionments.length > 0
      ? receipt.vendorApportionments
          .map((vendor) => `${vendor.vendorName} ${formatUsdCents(vendor.apportionedCents)}`)
          .join('; ')
      : 'none';
  const cells = [
    receipt.claimKey,
    receipt.customerName,
    `${receipt.billingMonth} (${receipt.billingTimezone})`,
    formatMinutes(math.netOutageMinutes),
    formatUsdCents(math.newCreditCents),
    formatUsdCents(math.vendorTotalApportionedCents),
    vendorSplit,
    formatUsdCents(math.internalAbsorbedCents),
    receipt.proposalVersionKey,
    receipt.receiptId,
    status,
  ];
  return [
    '| Claim | Customer | Billing month | Net outage | Customer credit | Vendor recovery | Vendor split | Internal absorbed | Proposal version key | Receipt | Status |',
    '| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- | --- |',
    `| ${cells.join(' | ')} |`,
  ].join('\n');
}

export function buildReceiptExportMarkdown(
  kind: ReceiptExportKind,
  receipt: CalculationReceipt,
  status: SettlementStatus,
): string {
  if (kind === 'customer-credit-receipt') {
    return customerCreditReceipt(receipt, status);
  }
  if (kind === 'vendor-recovery-claim') {
    return vendorRecoveryClaim(receipt);
  }
  return confluenceLedgerRow(receipt, status);
}
