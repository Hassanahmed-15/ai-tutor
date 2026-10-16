import { notFound } from "next/navigation";
import { FigureGalleryClient } from "./FigureGalleryClient";

/**
 * THE FIGURE GALLERY — every code-drawn textbook figure (lib/figures/components) on a real board,
 * with all its parts labelled, so the diagrams can be seen without generating a lesson. The licensed
 * textbook diagrams are reviewed at /figure-lab. Not served in production.
 */
export default function FigureGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FigureGalleryClient />;
}
