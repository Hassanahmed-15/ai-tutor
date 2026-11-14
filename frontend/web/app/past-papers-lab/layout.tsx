import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** A development page for the end-of-lesson past-paper practice; in production it does not exist. */
export default function PastPapersLabLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
