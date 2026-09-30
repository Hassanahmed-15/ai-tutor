import { NextResponse } from "next/server";
import { countryFromLanguage, sanitizeCountry } from "@/lib/education";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE VISITOR'S COUNTRY, to prefill onboarding (always editable there).
 *
 * By IP, through ipwho.is — free, keyless, HTTPS (owner's choice, 2026-09-29). Only the IP is sent.
 * Behind Azure's ingress the visitor's address is the first entry of X-Forwarded-For. A private or
 * loopback address (local development) is not sent: the lookup then asks about the server's own
 * address, which on a developer's machine IS the visitor's. If the lookup fails or times out, the
 * browser's language region ("en-GB") is used; if that says nothing either, the field starts empty.
 */
const cache = new Map<string, { country: string | null; at: number }>();
const DAY = 24 * 60 * 60 * 1000;

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "";
  const ip = forwarded.replace(/^::ffff:/, "");
  if (!ip) return null;
  const privateIp = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80)/i.test(ip);
  return privateIp ? null : ip;
}

async function lookup(ip: string | null): Promise<string | null> {
  const key = ip ?? "self";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.country;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`https://ipwho.is/${ip ? encodeURIComponent(ip) : ""}?fields=success,country_code`, { signal: controller.signal, cache: "no-store" });
    const data = (await res.json().catch(() => null)) as { success?: boolean; country_code?: string } | null;
    const country = data?.success ? sanitizeCountry(data.country_code) : null;
    cache.set(key, { country, at: Date.now() });
    return country;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const byIp = await lookup(clientIp(request));
  if (byIp) return NextResponse.json({ country: byIp, source: "ip" });
  const byLanguage = countryFromLanguage(request.headers.get("accept-language"));
  return NextResponse.json({ country: byLanguage, source: byLanguage ? "language" : null });
}
