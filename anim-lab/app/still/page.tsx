"use client";

import dynamic from "next/dynamic";

// One bench board, full size, in the PRODUCTION sandbox — what a lesson would show.
const Still = dynamic(() => import("./Still"), { ssr: false });

export default function Page() {
  return <Still />;
}
