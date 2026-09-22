import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aria Voice Lab",
  description: "Testing interface for the next voice turn-taking architecture. Separate from production.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
