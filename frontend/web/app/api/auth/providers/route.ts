import { NextResponse } from "next/server";
import { configuredProviders } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which "Continue with…" buttons can actually sign someone in on this deployment. */
export async function GET() {
  return NextResponse.json(configuredProviders());
}
