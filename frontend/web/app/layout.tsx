import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * NEVER CACHE THE APP SHELL.
 *
 * `/` was statically prerendered, so Next served it with `cache-control: s-maxage=31536000` and
 * `x-nextjs-cache: HIT` — one year. The HTML names the hashed JS chunks, so a browser holding that
 * cached shell kept loading the PREVIOUS build's JavaScript however many times the container was
 * redeployed: new image, new chunks on disk, and the user still looking at the old UI with nothing
 * to indicate why. That is not a caching win, it is a deploy that silently does not arrive.
 *
 * Declared here rather than in page.tsx because route config is server-only and page.tsx is a
 * client component — Next fails the build with "Invalid revalidate value" if you try.
 *
 * Nothing is lost: the shell branches on the signed-in user immediately, so it is per-request.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Typography: a humanist sans for everything the student operates, and one sharp serif for the
 * one line each screen says out loud (the question on the front page, a planning question, a
 * lesson title). Instrument Sans and Instrument Serif are cut as a pair. Geist/Inter were dropped
 * as the default of every AI product. The board keeps its own chalk and handwriting faces.
 */
const bodyFont = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
  display: "swap",
});

/** The display face: a sharp serif for the one line each screen says out loud. */
const displayFont = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display-face",
  weight: "400",
  style: ["normal", "italic"],
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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0B0713" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0713" },
  ],
};

/**
 * Light or dark, set before the first paint so the page never flashes the wrong theme. The student's
 * choice lives in this browser only (Settings → Appearance); with no choice, the device decides.
 */
const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("aria.theme");document.documentElement.dataset.theme=c==="light"?"light":"dark";}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`h-full antialiased ${bodyFont.variable} ${displayFont.variable} ${hudMonoFont.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
