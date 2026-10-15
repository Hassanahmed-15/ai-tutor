import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** A design demo of the first-run ideas (2026-10-13). Development only; in production it does not exist. */
export default function FirstRunLabLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.FIRST_RUN_LAB !== "1") notFound();
  return children;
}
