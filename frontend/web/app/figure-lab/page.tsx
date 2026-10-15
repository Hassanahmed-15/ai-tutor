import { notFound } from "next/navigation";
import { FigureLabClient } from "./FigureLabClient";

/**
 * THE FIGURE LAB — a development tool for reviewing the textbook diagram library
 * (data/figures/library, built by scripts/figures/*-library.mts). Each diagram is shown with every
 * part's anchor as a dot (green: traced along its leader; amber: guessed, needs a look) and its
 * licence; part names can be edited or dropped, and the diagram approved or rejected. Writes go
 * to data/figures/library/index.json through /api/figure-lab. Not served in production.
 */
export default function FigureLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FigureLabClient />;
}
