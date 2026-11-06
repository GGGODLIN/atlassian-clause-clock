export type ClauseClockSourceMode = 'LIVE_GRAPH_AND_REST' | 'SEEDED_FIXTURE';

export type ContractApprovalStatus = 'APPROVED' | 'DRAFT';

export interface HalfOpenInterval {
  id: string;
  label: string;
  startMinute: number;
  endMinute: number;
  sourceKey?: string;
  startIso?: string;
  endIso?: string;
  included?: boolean;
}

export interface VendorOutageFeed {
  vendorId: string;
  vendorName: string;
  componentKey: string;
  intervals: HalfOpenInterval[];
}

export interface SlaCreditTier {
  tierId: string;
  label: string;
  minUptimeBps: number;
  maxUptimeBps: number;
  minOutageMinutes?: number;
  maxOutageMinutes?: number;
  creditBps: number;
}

export interface CustomerSlaContract {
  contractId: string;
  customerName: string;
  customerId: string;
  claimKey: string;
  billingMonth: string;
  billingMonthTotalMinutes: number;
  billingTimezone?: string;
  contractStatus: ContractApprovalStatus;
  monthlyFeeCents: number;
  monthlyCapCents: number;
  priorApprovedCents: number;
  confluenceContractUrl: string;
  slaTiers: SlaCreditTier[];
}

export interface ClauseClockScenario {
  scenarioId: string;
  title: string;
  subtitle: string;
  description: string;
  contract: CustomerSlaContract;
  incidents: HalfOpenInterval[];
  maintenanceWindows: HalfOpenInterval[];
  vendorFeeds: VendorOutageFeed[];
  sourceMode?: ClauseClockSourceMode;
  fallbackReason?: string;
}

export interface AiOverrideAttempt {
  monthlyFeeCents?: number;
  newCreditCents?: number;
  creditBps?: number;
  reason?: string;
}

export interface ReconcileOptions {
  timezoneOverride?: string;
  disabledIncidentIds?: string[];
  disabledMaintenanceIds?: string[];
  aiOverrideAttempt?: AiOverrideAttempt;
  sourceMode?: ClauseClockSourceMode;
  fallbackReason?: string;
}

export interface VendorApportionmentRow {
  vendorId: string;
  vendorName: string;
  componentKey: string;
  overlapIntervals: HalfOpenInterval[];
  overlapMinutes: number;
  shareBps: number;
  exactCents: number;
  apportionedCents: number;
  remainderFraction: number;
}

export interface NaiveSpreadsheetComparison {
  rawIncidentSumMinutes: number;
  naiveUptimePct: number;
  naiveTierLabel: string;
  naiveCreditBps: number;
  naiveCreditCents: number;
  overchargePreventedCents: number;
  overcountedMinutes: number;
}

export interface SourceProvenanceManifest {
  sourceMode: ClauseClockSourceMode;
  fallbackReason: string | null;
  claimKey: string;
  contractId: string;
  confluenceContractUrl: string;
  billingTimezoneResolved: string;
  missingTimezoneFallback: boolean;
  provisionalDraftMode: boolean;
  evaluatedIncidentKeys: string[];
  evaluatedMaintenanceKeys: string[];
  evaluatedVendorKeys: string[];
}

export interface InputsSnapshot {
  billingMonthTotalMinutes: number;
  monthlyFeeCents: number;
  monthlyCapCents: number;
  priorApprovedCents: number;
  remainingCapBeforeCents: number;
}

export interface IntervalLedger {
  rawIncidents: HalfOpenInterval[];
  clippedIncidents: HalfOpenInterval[];
  mergedIncidents: HalfOpenInterval[];
  clippedMaintenance: HalfOpenInterval[];
  mergedMaintenance: HalfOpenInterval[];
  maintenanceDeductedSlices: HalfOpenInterval[];
  netOutageIntervals: HalfOpenInterval[];
}

export interface MathBreakdown {
  rawIncidentMinutes: number;
  mergedIncidentMinutes: number;
  maintenanceDeductedMinutes: number;
  netOutageMinutes: number;
  uptimePercentage: number;
  uptimeBps: number;
  matchedTier: SlaCreditTier;
  grossCreditCents: number;
  priorApprovedCents: number;
  remainingCapBeforeCents: number;
  uncappedAvailableCreditCents: number;
  capTruncated: boolean;
  newCreditCents: number;
  remainingCapAfterCents: number;
  vendorCoveredMinutes: number;
  vendorTotalApportionedCents: number;
  internalAbsorbedMinutes: number;
  internalAbsorbedCents: number;
}

export interface CalculationReceipt {
  receiptId: string;
  proposalVersionKey: string;
  scenarioId: string;
  claimKey: string;
  customerId: string;
  customerName: string;
  billingMonth: string;
  billingTimezone: string;
  missingTimezoneFallback: boolean;
  boundaryClippedCount: number;
  provisionalDraftMode: boolean;
  inputsSnapshot: InputsSnapshot;
  intervalLedger: IntervalLedger;
  mathBreakdown: MathBreakdown;
  vendorApportionments: VendorApportionmentRow[];
  naiveComparison: NaiveSpreadsheetComparison;
  discardedAiAmountOverrides: string[];
  provenance: SourceProvenanceManifest;
  replayCommand: string;
  machineReadableFooter: string;
}

export interface BitmapOracleInput {
  billingMonthTotalMinutes: number;
  incidents: HalfOpenInterval[];
  maintenanceWindows: HalfOpenInterval[];
  vendorFeeds?: VendorOutageFeed[];
}

export interface BitmapOracleResult {
  netOutageMinutes: number;
  mergedIncidentMinutes: number;
  maintenanceDeductedMinutes: number;
  vendorCoveredUnionMinutes: number;
  vendorOverlapMinutesByVendorId: Record<string, number>;
}

export interface ClauseClockPbtAuditOptions {
  numRuns?: number;
  seed?: number;
}

export interface ClauseClockPbtAuditReport {
  passed: boolean;
  numRuns: number;
  seed: number;
  invariants: {
    P1: boolean;
    P2: boolean;
    P3: boolean;
  };
  reachabilityWitnesses: {
    overlapFoldedCount: number;
    maintenanceDeductedCount: number;
    capTruncatedCount: number;
    multiVendorSplitCount: number;
  };
  oracleCalibration: {
    p1NaiveSumDetected: boolean;
    p2UncappedDetected: boolean;
    p3FloatDriftDetected: boolean;
  };
  counterexampleReplay: {
    scenarioId: string;
    naiveMinutes: number;
    naiveCreditCents: number;
    clauseClockMinutes: number;
    clauseClockCreditCents: number;
    overchargePreventedCents: number;
  };
}
