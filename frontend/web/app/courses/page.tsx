"use client";

import Home from "../page";

/**
 * Students and reviewers open the tutor at /courses.
 *
 * The app itself does not use the URL to switch screens — one client component swaps views —
 * so a path with no page file was Next's 404 ("This page could not be found") even though
 * the same tutor is served at /. This route renders that app in place, and the address stays
 * /courses.
 */
export default function CoursesPage() {
  return <Home />;
}
