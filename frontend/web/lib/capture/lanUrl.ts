import "server-only";
import os from "node:os";

/**
 * WHERE THE PHONE OPENS THE CAPTURE PAGE. `PUBLIC_BASE_URL` when it is set (the live site). Otherwise the address the
 * computer itself used — unless that is localhost, which a phone cannot reach: then this PC's own address on the
 * Wi-Fi/LAN (virtual adapters skipped), on the same port, so a phone on the same network can open it.
 * `CAPTURE_LAN_HOST` overrides the address picked.
 */
const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vmware|vbox|bluetooth|loopback|docker|tailscale|zerotier|npcap/i;

export function lanAddresses(): string[] {
  const out: Array<{ address: string; rank: number }> = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // A home or school Wi-Fi first (192.168.x, 10.x), then the other private ranges.
      const rank = a.address.startsWith("192.168.") ? 0 : a.address.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3;
      out.push({ address: a.address, rank });
    }
  }
  return out.sort((x, y) => x.rank - y.rank).map((x) => x.address);
}

export function captureBaseUrl(requestUrl: string): { base: string; lan: boolean } {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) return { base: configured, lan: false };
  const url = new URL(requestUrl);
  // 0.0.0.0 / [::] is what the request URL says when the server listens on every interface (`next dev -H 0.0.0.0`).
  if (!/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\[::\])$/i.test(url.hostname)) return { base: url.origin, lan: /^(192\.168|10\.|172\.)/.test(url.hostname) };
  const host = process.env.CAPTURE_LAN_HOST?.trim() || lanAddresses()[0];
  if (!host) return { base: url.origin, lan: false };
  return { base: `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`, lan: true };
}
