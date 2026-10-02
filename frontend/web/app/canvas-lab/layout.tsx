import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
import { canvasLabOpen } from "../api/canvas-lecture/access";

/** The lab is a development tool (see canvasLabOpen); in production it does not exist. */
export default function CanvasLabLayout({ children }: { children: React.ReactNode }) {
  if (!canvasLabOpen()) notFound();
  return children;
}
