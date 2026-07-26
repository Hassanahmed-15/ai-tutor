import type { Metadata } from "next";
import { Lexend, Plus_Jakarta_Sans, Space_Grotesk, JetBrains_Mono, Kalam } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

// Handwriting face for the teaching board so it reads like a real hand-lettered class board on
// EVERY machine (the old stack relied on system fonts like Chalkboard/Comic Sans that most devices
// don't have, silently falling back to a generic sans). Kalam has near-normal metrics so it doesn't
// overflow the board layout (unlike the wider Caveat script).
const boardHandFont = Kalam({
  subsets: ["latin"],
  variable: "--font-board-hand",
  weight: ["300", "400", "700"],
  display: "swap",
});

const bodyFont = Lexend({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const headlineFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-headline",
  weight: ["700", "800"],
  display: "swap",
});

// Technical geometric display face for the holographic HUD redesign — precise, instrument-like.
const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Monospace face for HUD data labels: eyebrows, status chips, step counters.
const hudMonoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-hud-mono",
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aria — Learning, shaped to every mind",
  description: "A living, adaptive AI tutor. One lesson, many minds — for disabled and non-disabled learners alike.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${bodyFont.variable} ${headlineFont.variable} ${displayFont.variable} ${hudMonoFont.variable} ${boardHandFont.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
