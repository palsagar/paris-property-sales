import { BlockList } from "node:net";
import { rateLimit } from "express-rate-limit";
import { inList } from "./visitorIp";

/**
 * Each Visitor may make 600 API requests a minute. One Selection change makes about a dozen, so a Visitor would need
 * 50 changes in one minute to reach it. A shared address, such as an office or a mobile network, leaves room for
 * several Visitors.
 */
export const API_RATE_LIMIT = { limit: 600, windowMs: 60_000 };

// The machine itself and private networks: the warm-up (lib/prewarm.ts), a local test, or Docker's own network.
const local = new BlockList();
local.addSubnet("127.0.0.0", 8, "ipv4");
local.addSubnet("10.0.0.0", 8, "ipv4");
local.addSubnet("172.16.0.0", 12, "ipv4");
local.addSubnet("192.168.0.0", 16, "ipv4");
local.addSubnet("169.254.0.0", 16, "ipv4");
local.addAddress("::1", "ipv6");
local.addSubnet("fc00::", 7, "ipv6");
local.addSubnet("fe80::", 10, "ipv6");

/** Built once for each app, so that each test app has its own counts. It needs req.ip set by lib/visitorIp.ts. */
export function createApiRateLimit() {
  return rateLimit({
    ...API_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => inList(local, req.ip),
    message: { error: "Too many requests. Please wait a minute and try again." },
  });
}
