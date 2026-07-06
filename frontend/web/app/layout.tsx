import type { Metadata } from "next";
import { Lexend, Plus_Jakarta_Sans, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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
    <html lang="en" className={`h-full antialiased ${bodyFont.variable} ${headlineFont.variable} ${displayFont.variable} ${hudMonoFont.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
