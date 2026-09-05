import type { Metadata } from 'next';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/**
 * The type thesis: prose in Instrument Sans, every number and identifier in
 * JetBrains Mono with tabular figures. Self-hosted through next/font so the
 * page makes no third-party request and the decimal points line up on first
 * paint rather than after a swap.
 */
const sans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Settled',
  description: 'Three-way reconciliation across ledger, gateway and bank.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable + ' ' + mono.variable}>
      <body>{children}</body>
    </html>
  );
}
