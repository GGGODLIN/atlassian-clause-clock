'use client';

import type { SettlementStatus } from '../../src/actions/clause-clock-store.ts';
import type { CalculationReceipt } from '../../src/core/clause-clock-types.ts';
import { buildReceiptExportMarkdown, RECEIPT_EXPORTS, type ReceiptExportKind } from './receipt-markdown.ts';

export interface ReceiptExportsProps {
  receipt: CalculationReceipt;
  status: SettlementStatus;
  lastCopied: ReceiptExportKind | null;
  onCopy: (kind: ReceiptExportKind) => void;
}

export function ReceiptExports({ receipt, status, lastCopied, onCopy }: ReceiptExportsProps) {
  return (
    <section aria-labelledby="cc-exports-heading" className="cc-rise flex flex-col gap-3">
      <div>
        <p className="cc-eyebrow text-steel">
          {status === 'SETTLED' ? 'Settled receipt' : 'Proposal receipt'} · {receipt.receiptId}
        </p>
        <h2 id="cc-exports-heading" className="mt-1 font-display text-3xl leading-none">
          One-click Markdown
        </h2>
      </div>
      {RECEIPT_EXPORTS.map((descriptor) => {
        const copied = lastCopied === descriptor.kind;
        return (
          <article
            key={descriptor.kind}
            className="cc-ticket relative px-6 py-4 shadow-[0_10px_24px_-20px_rgb(17_17_17/0.7)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <button
                  type="button"
                  data-testid="receipt-export"
                  data-export-kind={descriptor.kind}
                  onClick={() => onCopy(descriptor.kind)}
                  className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper transition hover:bg-ink-soft active:scale-[0.98]"
                >
                  {descriptor.label}
                </button>
                <p className="mt-2 font-mono text-[11px] text-steel">{descriptor.audience}</p>
              </div>
              <span
                role="status"
                className={`cc-eyebrow text-[10px] transition-opacity ${copied ? 'text-blued opacity-100' : 'opacity-0'}`}
              >
                {copied ? 'Copied ✓' : ''}
              </span>
            </div>
            <details className="group mt-3 border-t border-dashed border-rule pt-2">
              <summary className="cursor-pointer list-none font-mono text-[11px] text-steel hover:text-ink">
                <span className="group-open:hidden">▸ Preview Markdown</span>
                <span className="hidden group-open:inline">▾ Hide preview</span>
              </summary>
              <pre className="cc-scroll mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-dial p-3 font-mono text-[11px] leading-relaxed text-ink-soft">
                {buildReceiptExportMarkdown(descriptor.kind, receipt, status)}
              </pre>
            </details>
          </article>
        );
      })}
    </section>
  );
}
