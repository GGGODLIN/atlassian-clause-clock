'use client';

import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';
import { formatBps, formatMinutes, formatUsdCents } from './format.ts';

const VENDOR_SWATCHES = ['bg-blued', 'bg-blued-soft', 'bg-blued-pale'] as const;

export interface VendorApportionmentTableProps {
  receipt: CalculationReceipt;
}

export function VendorApportionmentTable({ receipt }: VendorApportionmentTableProps) {
  const math = receipt.mathBreakdown;
  const vendorCents = receipt.vendorApportionments.reduce((sum, vendor) => sum + vendor.apportionedCents, 0);
  const balanced = vendorCents + math.internalAbsorbedCents === math.newCreditCents;

  return (
    <section
      data-testid="vendor-apportionment-table"
      aria-labelledby="cc-ledger-heading"
      className="cc-paper cc-rise relative overflow-hidden rounded-[2rem] p-5 @3xl:p-7"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cc-eyebrow text-steel">Audit ledger · Largest Remainder Method · integer cents</p>
          <h2 id="cc-ledger-heading" className="mt-1 font-display text-3xl leading-none @3xl:text-4xl">
            Upstream Vendor Apportionment
          </h2>
        </div>
        <p className="font-mono text-[11px] text-steel">
          credit basis {formatUsdCents(math.newCreditCents)} · net {formatMinutes(math.netOutageMinutes)}
        </p>
      </header>

      <div className="cc-scroll mt-5 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <thead>
            <tr className="cc-eyebrow border-b-2 border-ink text-[10px] text-steel">
              <th scope="col" className="py-2 pr-3 font-semibold">Party</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Overlap</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Share</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Exact ¢</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Remainder</th>
              <th scope="col" className="py-2 text-right font-semibold">Apportioned</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[13px]">
            {receipt.vendorApportionments.map((vendor, vendorPosition) => (
              <tr
                key={vendor.vendorId}
                data-testid="vendor-apportionment-row"
                data-vendor-id={vendor.vendorId}
                data-overlap-minutes={vendor.overlapMinutes}
                data-apportioned-cents={vendor.apportionedCents}
                className="border-b border-ink/10"
              >
                <th scope="row" className="py-2.5 pr-3 font-sans font-normal">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={`size-2.5 rounded-sm ${VENDOR_SWATCHES[vendorPosition % 3]}`} />
                    <span className="font-semibold text-ink">{vendor.vendorName}</span>
                  </span>
                  <span className="mt-0.5 block pl-[1.125rem] font-mono text-[11px] text-steel">
                    {vendor.vendorId} · {vendor.componentKey}
                  </span>
                </th>
                <td className="py-2.5 pr-3 text-right">{formatMinutes(vendor.overlapMinutes)}</td>
                <td className="py-2.5 pr-3 text-right">{formatBps(vendor.shareBps)}</td>
                <td className="py-2.5 pr-3 text-right text-steel">{vendor.exactCents.toFixed(4)}</td>
                <td className="py-2.5 pr-3 text-right text-steel">{vendor.remainderFraction.toFixed(6)}</td>
                <td className="py-2.5 text-right font-semibold text-blued">{formatUsdCents(vendor.apportionedCents)}</td>
              </tr>
            ))}
            <tr
              data-testid="internal-absorption-row"
              data-apportioned-cents={math.internalAbsorbedCents}
              className="border-b border-ink/10"
            >
              <th scope="row" className="py-2.5 pr-3 font-sans font-normal">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 rounded-sm border border-ink/40" />
                  <span className="font-semibold text-ink">Internal absorption</span>
                </span>
                <span className="mt-0.5 block pl-[1.125rem] font-mono text-[11px] text-steel">
                  net minutes no upstream window covers
                </span>
              </th>
              <td className="py-2.5 pr-3 text-right">{formatMinutes(math.internalAbsorbedMinutes)}</td>
              <td className="py-2.5 pr-3 text-right text-steel">—</td>
              <td className="py-2.5 pr-3 text-right text-steel">—</td>
              <td className="py-2.5 pr-3 text-right text-steel">—</td>
              <td className="py-2.5 text-right font-semibold">{formatUsdCents(math.internalAbsorbedCents)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr
              data-testid="cent-conservation-check"
              data-balanced={balanced}
              className="font-mono text-[13px] [&>*]:border-b-4 [&>*]:border-double [&>*]:border-ink"
            >
              <th scope="row" className="py-3 pr-3 font-sans text-sm font-semibold">
                Σ vendors + internal
              </th>
              <td className="py-3 pr-3 text-right">{formatMinutes(math.netOutageMinutes)}</td>
              <td colSpan={3} className="py-3 pr-3 text-right text-steel">
                {formatUsdCents(vendorCents)} + {formatUsdCents(math.internalAbsorbedCents)} =
              </td>
              <td className="py-3 text-right text-base font-semibold">{formatUsdCents(math.newCreditCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div
        aria-label={balanced ? 'Cent conservation holds' : 'Cent conservation broken'}
        role="img"
        className={`cc-stamp pointer-events-none absolute right-6 top-5 px-3 py-1.5 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.18em] @3xl:right-10 ${
          balanced ? 'text-blued' : 'text-signal'
        }`}
      >
        {balanced ? 'Balanced' : 'Drift'}
        <span className="block text-[9px] tracking-[0.12em]">to the cent</span>
      </div>
    </section>
  );
}
