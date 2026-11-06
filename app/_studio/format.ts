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

// Minute 0 is midnight of the billing month in the billing timezone, so UTC arithmetic yields billing-local wall-clock time.
export function billingClockParts(billingMonth: string, minute: number): BillingClockParts {
  const [yearText, monthText] = billingMonth.split('-');
  const instant = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1) + minute * 60_000);
  const isoDate = `${instant.getUTCFullYear()}-${pad2(instant.getUTCMonth() + 1)}-${pad2(instant.getUTCDate())}`;
  return {
    isoDate,
    monthDay: `${MONTH_ABBREVIATIONS[instant.getUTCMonth()]} ${pad2(instant.getUTCDate())}`,
    time: `${pad2(instant.getUTCHours())}:${pad2(instant.getUTCMinutes())}`,
  };
}

export function formatBillingRange(billingMonth: string, startMinute: number, endMinute: number): string {
  const start = billingClockParts(billingMonth, startMinute);
  const end = billingClockParts(billingMonth, endMinute);
  const endLabel = end.isoDate === start.isoDate ? end.time : `${end.isoDate} ${end.time}`;
  return `${start.isoDate} ${start.time} → ${endLabel}`;
}
