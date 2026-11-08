import { BlockList, isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

/**
 * In production a request goes Visitor → Cloudflare → Traefik (Coolify's proxy) → Node.
 *
 * Express trusts only proxies on the machine itself or a private network, which is where Traefik runs. req.ip is then
 * the address that Traefik received the request from: Cloudflare's, or a client's that reached the server directly.
 * Traefik by default replaces any X-Forwarded-For that comes from outside, so an address count would be wrong.
 */
export const TRUSTED_PROXIES = ["loopback", "linklocal", "uniquelocal"];

// Cloudflare's published ranges, from https://www.cloudflare.com/ips/ (checked 2026-11-09).
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [address, prefix] = range.split("/") as [string, string];
  cloudflare.addSubnet(address, Number(prefix), isIP(address) === 6 ? "ipv6" : "ipv4");
}

/** Whether the address is in the list. An IPv4 address written as IPv6 ("::ffff:1.2.3.4") counts as IPv4. */
export function inList(list: BlockList, ip: string | undefined): boolean {
  const address = ip?.replace(/^::ffff:(?=\d+\.)/, "") ?? "";
  const family = isIP(address);
  return family !== 0 && list.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * Makes req.ip the Visitor's address. Cloudflare sends it in CF-Connecting-IP and replaces any value the Visitor sent.
 * The header is used only when the request came from a Cloudflare address, because anyone else can write it.
 */
export function visitorIp(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers["cf-connecting-ip"];
  if (typeof header === "string" && isIP(header) && inList(cloudflare, req.ip)) {
    Object.defineProperty(req, "ip", { value: header });
  }
  next();
}
