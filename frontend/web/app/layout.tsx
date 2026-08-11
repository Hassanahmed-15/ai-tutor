import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Typography for the editorial rebuild.
 *
 * The previous system was three sans faces — a geometric technical display (Space Grotesk) over
 * Lexend and Plus Jakarta. That trio is what made the product read as an instrument panel. An
 * editorial page needs the opposite: one serif doing all the talking at large sizes, and a plain
 * text face that gets out of its way.
 *
 * Instrument Serif is a high-contrast display serif with a genuine italic — it carries a 96px
 * headline the way a masthead does, and it costs one weight rather than four.
 */
const displayFont = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

/** Body and UI text. Neutral on purpose: the serif is the voice, this is the paper. */
const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

// Note: `--font-headline` is still read by the mode players, which are out of scope here. It is
// aliased to the body face in globals.css rather than loading a fourth family for screens this
// rebuild does not touch.

// Monospace, kept for small caps labels: section numerals, step counters, metadata.
const hudMonoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-hud-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aria — Every lecture, written once, for you",
  description:
    "Name a subject and Aria composes the lecture from nothing: a plan you approve, a board drawn while it speaks, and a teacher that stops the moment you have a question.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${bodyFont.variable} ${displayFont.variable} ${hudMonoFont.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
