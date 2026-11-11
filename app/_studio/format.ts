import { Temporal } from '@js-temporal/polyfill';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function formatUsdCents(cents: number): string {
  return USD.format(cents / 100);
}

export function formatMinutes(minutes: number): string {
  return `${minutes}m`;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Dial geometry: 0° points at 12 o'clock and angles grow clockwise, the way watch indices are read.
export function polarPoint(centre: number, radius: number, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: roundTo2(centre + radius * Math.sin(radians)), y: roundTo2(centre - radius * Math.cos(radians)) };
}

export interface BillingClockParts {
  isoDate: string;
  monthDay: string;
  time: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function billingClockParts(billingMonth: string, minute: number, timezone = 'UTC'): BillingClockParts {
  const origin = Temporal.PlainYearMonth.from(billingMonth).toPlainDate({ day: 1 }).toZonedDateTime(timezone);
  const instant = origin.add({ minutes: minute });
  return {
    isoDate: instant.toPlainDate().toString(),
    monthDay: `${MONTH_ABBREVIATIONS[instant.month - 1]} ${pad2(instant.day)}`,
    time: `${pad2(instant.hour)}:${pad2(instant.minute)}`,
  };
}

export function formatBillingRange(billingMonth: string, startMinute: number, endMinute: number, timezone = 'UTC'): string {
  const start = billingClockParts(billingMonth, startMinute, timezone);
  const end = billingClockParts(billingMonth, endMinute, timezone);
  const endLabel = end.isoDate === start.isoDate ? end.time : `${end.isoDate} ${end.time}`;
  return `${start.isoDate} ${start.time} → ${endLabel}`;
}
