import type { Metadata } from "next";
import { Manrope, Outfit } from "next/font/google";
import "./globals.css";

const bodyFont = Manrope({ subsets: ["latin"], variable: "--font-body", weight: "variable", display: "swap" });
const displayFont = Outfit({ subsets: ["latin"], variable: "--font-display-face", weight: ["300", "400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "Aria courses",
  description: "Every official syllabus Aria teaches — Pakistan, US and international — down to single lessons and their learning goals.",
};

const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("aria.theme");document.documentElement.dataset.theme=c==="light"?"light":"dark";}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`h-full antialiased ${bodyFont.variable} ${displayFont.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
