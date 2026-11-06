import type { Metadata } from 'next';
import { IBM_Plex_Mono, Instrument_Sans, Instrument_Serif } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const displayFace = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
});

const interfaceFace = Instrument_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const ledgerFace = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ClauseClock — SLA Interval Splicer & Vendor Apportionment Studio',
  description:
    'Deterministic JSM SLA credit settlement: fold overlapping incidents, deduct maintenance, clip to the billing month, cap the credit, and split vendor recovery to the cent.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${displayFace.variable} ${interfaceFace.variable} ${ledgerFace.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
