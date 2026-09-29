import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Animation Lab", description: "React sandbox vs Motion, GSAP, Remotion and Lottie on one generated lecture." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
