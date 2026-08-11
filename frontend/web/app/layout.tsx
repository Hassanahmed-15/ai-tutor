import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Typography: one family, used lightly.
 *
 * Everything is Inter. The display face is the same font at weight 300 with tight tracking — a
 * large headline set light and straight, with no serif and no second family to argue with it.
 * Loading one family also means the page has no flash of a mismatched fallback.
 *
 * The previous attempts loaded three sans faces (which read as an instrument panel) and then a
 * high-contrast serif (which read as a newspaper). Both were louder than the content.
 */
const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "500"],
  display: "swap",
});

// `--font-display` is aliased to the body face in globals.css: the whole system is one family, so
// there is no second font to load.

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
    <html lang="en" className={`h-full antialiased ${bodyFont.variable} ${hudMonoFont.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
