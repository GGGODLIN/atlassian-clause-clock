import type { ClauseClockScenario, SlaCreditTier } from './clause-clock-types.ts';

export const STANDARD_SLA_TIERS: readonly SlaCreditTier[] = [
  {
    tierId: 'TIER-0-COMPLIANT',
    label: '99.90% - 100.00% (Compliant)',
    minUptimeBps: 9990,
    maxUptimeBps: 10000,
    minOutageMinutes: 0,
    maxOutageMinutes: 43,
    creditBps: 0,
  },
  {
    tierId: 'TIER-1-10PCT',
    label: '99.75% - <99.90% (10% Service Credit)',
    minUptimeBps: 9975,
    maxUptimeBps: 9989,
    minOutageMinutes: 44,
    maxOutageMinutes: 100,
    creditBps: 1000,
  },
  {
    tierId: 'TIER-2-25PCT',
    label: '99.00% - <99.75% (25% Service Credit)',
    minUptimeBps: 9900,
    maxUptimeBps: 9974,
    minOutageMinutes: 101,
    maxOutageMinutes: 432,
    creditBps: 2500,
  },
  {
    tierId: 'TIER-3-50PCT',
    label: '<99.00% (50% Service Credit)',
    minUptimeBps: 0,
    maxUptimeBps: 9899,
    minOutageMinutes: 433,
    maxOutageMinutes: 44640,
    creditBps: 5000,
  },
];

export const CLAUSE_CLOCK_SEEDED_SCENARIOS: readonly ClauseClockScenario[] = [
  {
    scenarioId: 'hero-overlap-splicer',
    title: '1. Hero Overlap & Maintenance Splicer ($5,000 -> $1,500)',
    subtitle: 'JSM-402 · Acme Global Retail · 2 Overlapping Incidents minus 15m Maintenance',
    description:
      'Two 60-minute P1 incidents overlap by 30 minutes (90m union) and intersect a 15-minute scheduled change window (75m net outage = 99.8266% uptime). Prevents a $3,500 spreadsheet overcharge and apportions 60% ($900) to CloudEdge Transit and 40% ($600) to internal absorption.',
    sourceMode: 'SEEDED_FIXTURE',
    contract: {
      contractId: 'CTR-ACME-2026-Q4',
      customerName: 'Acme Global Retail',
      customerId: 'CUST-ACME-01',
      claimKey: 'JSM-402',
      billingMonth: '2026-11',
      billingMonthTotalMinutes: 43200,
      billingTimezone: 'America/New_York',
      contractStatus: 'APPROVED',
      monthlyFeeCents: 2000000,
      monthlyCapCents: 600000,
      priorApprovedCents: 50000,
      confluenceContractUrl:
        'https://acme-enterprise.atlassian.net/wiki/spaces/LEGAL/pages/402001/Master+SLA+Schedule+2026',
      slaTiers: [...STANDARD_SLA_TIERS],
    },
    incidents: [
      {
        id: 'INC-901',
        label: 'INC-901 · Checkout API Gateway 502s',
        startMinute: 600,
        endMinute: 660,
        sourceKey: 'INC-901',
        startIso: '2026-11-01T09:00:00-05:00',
        endIso: '2026-11-01T10:00:00-05:00',
        included: true,
      },
      {
        id: 'INC-902',
        label: 'INC-902 · Payment Tokenization Latency Spike',
        startMinute: 630,
        endMinute: 690,
        sourceKey: 'INC-902',
        startIso: '2026-11-01T09:30:00-05:00',
        endIso: '2026-11-01T10:30:00-05:00',
        included: true,
      },
    ],
    maintenanceWindows: [
      {
        id: 'CHG-210',
        label: 'CHG-210 · Scheduled TLS Certificate Rotation',
        startMinute: 645,
        endMinute: 660,
        sourceKey: 'CHG-210',
        startIso: '2026-11-01T09:45:00-05:00',
        endIso: '2026-11-01T10:00:00-05:00',
        included: true,
      },
    ],
    vendorFeeds: [
      {
        vendorId: 'VEND-CLOUD-NET',
        vendorName: 'CloudEdge Transit',
        componentKey: 'edge-bgp-us-east',
        intervals: [
          {
            id: 'VOUT-701',
            label: 'CloudEdge US-East BGP Route Flap',
            startMinute: 600,
            endMinute: 645,
            sourceKey: 'VOUT-701',
            startIso: '2026-11-01T09:00:00-05:00',
            endIso: '2026-11-01T09:45:00-05:00',
            included: true,
          },
        ],
      },
    ],
  },
  {
    scenarioId: 'cross-timezone-boundary',
    title: '2. Cross-Timezone Month Boundary Clipping (UTC Fallback)',
    subtitle: 'JSM-418 · Meridian FinTech Corp · Missing Contract Timezone & Month-End Clipping',
    description:
      'Contract omits billingTimezone (defaults to UTC). The outage from November 30 23:20Z to December 1 00:20Z clips 20 post-month minutes in UTC (40m, $0), while all 60 minutes remain in the November America/Los_Angeles billing window ($1,500).',
    sourceMode: 'SEEDED_FIXTURE',
    contract: {
      contractId: 'CTR-MERIDIAN-2026-Q4',
      customerName: 'Meridian FinTech Corp',
      customerId: 'CUST-MERIDIAN-02',
      claimKey: 'JSM-418',
      billingMonth: '2026-11',
      billingMonthTotalMinutes: 43200,
      billingTimezone: undefined,
      contractStatus: 'APPROVED',
      monthlyFeeCents: 1500000,
      monthlyCapCents: 450000,
      priorApprovedCents: 0,
      confluenceContractUrl:
        'https://acme-enterprise.atlassian.net/wiki/spaces/LEGAL/pages/418002/Meridian+SLA+Addendum',
      slaTiers: [...STANDARD_SLA_TIERS],
    },
    incidents: [
      {
        id: 'INC-940',
        label: 'INC-940 · Cross-Month Ledger Sync Outage',
        startMinute: 43160,
        endMinute: 43220,
        sourceKey: 'INC-940',
        startIso: '2026-11-30T23:20:00Z',
        endIso: '2026-12-01T00:20:00Z',
        included: true,
      },
    ],
    maintenanceWindows: [],
    vendorFeeds: [
      {
        vendorId: 'VEND-AUTH-GRID',
        vendorName: 'AuthGrid Identity',
        componentKey: 'oidc-token-signer',
        intervals: [
          {
            id: 'VOUT-740',
            label: 'AuthGrid Signing Key Rollover Delay',
            startMinute: 43160,
            endMinute: 43190,
            sourceKey: 'VOUT-740',
            startIso: '2026-11-30T23:20:00Z',
            endIso: '2026-11-30T23:50:00Z',
            included: true,
          },
        ],
      },
    ],
  },
  {
    scenarioId: 'monthly-cap-truncation',
    title: '3. Monthly Cap Truncation & 3-Vendor Largest-Remainder Tie-Break',
    subtitle: 'JSM-425 · Titan Cloud Logistics · $3,000 Gross Capped to $800 Across 3 Equal Vendors',
    description:
      'A 60-minute net outage triggers a 10% gross credit ($3,000 on $30,000 fee), but $3,200 of the $4,000 monthly cap was already approved on prior claims, truncating newCreditCents to $800 (80,000 cents). Three upstream vendors with identical 20-minute overlaps split 80,000 cents via Largest Remainder into 26,667 + 26,667 + 26,666 === 80,000.',
    sourceMode: 'SEEDED_FIXTURE',
    contract: {
      contractId: 'CTR-TITAN-2026-Q4',
      customerName: 'Titan Cloud Logistics',
      customerId: 'CUST-TITAN-03',
      claimKey: 'JSM-425',
      billingMonth: '2026-11',
      billingMonthTotalMinutes: 43200,
      billingTimezone: 'UTC',
      contractStatus: 'APPROVED',
      monthlyFeeCents: 3000000,
      monthlyCapCents: 400000,
      priorApprovedCents: 320000,
      confluenceContractUrl:
        'https://acme-enterprise.atlassian.net/wiki/spaces/LEGAL/pages/425003/Titan+Master+SLA',
      slaTiers: [...STANDARD_SLA_TIERS],
    },
    incidents: [
      {
        id: 'INC-960',
        label: 'INC-960 · Multi-Region Dispatch Queue Stall',
        startMinute: 1200,
        endMinute: 1260,
        sourceKey: 'INC-960',
        startIso: '2026-11-01T20:00:00Z',
        endIso: '2026-11-01T21:00:00Z',
        included: true,
      },
    ],
    maintenanceWindows: [],
    vendorFeeds: [
      {
        vendorId: 'VEND-ALPHA-DNS',
        vendorName: 'AlphaDNS Anycast',
        componentKey: 'dns-authoritative-eu',
        intervals: [
          {
            id: 'VOUT-801',
            label: 'AlphaDNS Resolver Timeout',
            startMinute: 1200,
            endMinute: 1220,
            sourceKey: 'VOUT-801',
            included: true,
          },
        ],
      },
      {
        vendorId: 'VEND-BETA-MQ',
        vendorName: 'BetaStream Brokers',
        componentKey: 'kafka-cluster-02',
        intervals: [
          {
            id: 'VOUT-802',
            label: 'BetaStream Leader Election Loop',
            startMinute: 1220,
            endMinute: 1240,
            sourceKey: 'VOUT-802',
            included: true,
          },
        ],
      },
      {
        vendorId: 'VEND-GAMMA-DB',
        vendorName: 'GammaStore Cloud',
        componentKey: 'storage-nvme-pool',
        intervals: [
          {
            id: 'VOUT-803',
            label: 'GammaStore Write Quorum Degradation',
            startMinute: 1240,
            endMinute: 1260,
            sourceKey: 'VOUT-803',
            included: true,
          },
        ],
      },
    ],
  },
  {
    scenarioId: 'unapproved-contract-draft',
    title: '4. Unapproved Draft Contract Lock (Provisional Preview Mode)',
    subtitle: 'JSM-439 · Nova BioLabs · Contract Status DRAFT Requires Finance Override to Commit',
    description:
      'Contract clause is still in DRAFT status in Legal review. ClauseClock computes the full interval algebra and vendor split preview with provisionalDraftMode: true, while locking settlement write-back unless an explicit financeOverrideReason is supplied.',
    sourceMode: 'SEEDED_FIXTURE',
    contract: {
      contractId: 'CTR-NOVA-2026-DRAFT',
      customerName: 'Nova BioLabs',
      customerId: 'CUST-NOVA-04',
      claimKey: 'JSM-439',
      billingMonth: '2026-11',
      billingMonthTotalMinutes: 43200,
      billingTimezone: 'America/New_York',
      contractStatus: 'DRAFT',
      monthlyFeeCents: 1800000,
      monthlyCapCents: 540000,
      priorApprovedCents: 0,
      confluenceContractUrl:
        'https://acme-enterprise.atlassian.net/wiki/spaces/LEGAL/pages/439004/Nova+BioLabs+DRAFT+SLA',
      slaTiers: [...STANDARD_SLA_TIERS],
    },
    incidents: [
      {
        id: 'INC-981',
        label: 'INC-981 · Genomics Pipeline Webhook Backlog',
        startMinute: 2400,
        endMinute: 2490,
        sourceKey: 'INC-981',
        startIso: '2026-11-02T15:00:00-05:00',
        endIso: '2026-11-02T16:30:00-05:00',
        included: true,
      },
    ],
    maintenanceWindows: [
      {
        id: 'CHG-299',
        label: 'CHG-299 · Planned Schema Compaction',
        startMinute: 2460,
        endMinute: 2490,
        sourceKey: 'CHG-299',
        startIso: '2026-11-02T16:00:00-05:00',
        endIso: '2026-11-02T16:30:00-05:00',
        included: true,
      },
    ],
    vendorFeeds: [
      {
        vendorId: 'VEND-CLOUD-NET',
        vendorName: 'CloudEdge Transit',
        componentKey: 'edge-bgp-us-east',
        intervals: [
          {
            id: 'VOUT-901',
            label: 'CloudEdge Packet Loss Window',
            startMinute: 2400,
            endMinute: 2430,
            sourceKey: 'VOUT-901',
            included: true,
          },
        ],
      },
    ],
  },
];

export function getSeededScenario(scenarioId?: string): ClauseClockScenario {
  if (!scenarioId) {
    return CLAUSE_CLOCK_SEEDED_SCENARIOS[0]!;
  }
  const found = CLAUSE_CLOCK_SEEDED_SCENARIOS.find(
    (scenario) =>
      scenario.scenarioId === scenarioId ||
      scenario.contract.claimKey.toLowerCase() === scenarioId.toLowerCase(),
  );
  return found ?? CLAUSE_CLOCK_SEEDED_SCENARIOS[0]!;
}
