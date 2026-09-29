"use client";

import dynamic from "next/dynamic";

// Client-only: lottie-web, the Remotion player and the eval'd boards all need a browser.
const Lab = dynamic(() => import("./Lab"), { ssr: false });

export default function Page() {
  return <Lab />;
}
