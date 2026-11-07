import { logger } from "./logger";
import { communeNames, quartierNames } from "./salesData";
import { warmUrls } from "./warmUrls";

export async function prewarm(port: number): Promise<void> {
  const started = Date.now();
  let count = 0;
  let failed = 0;
  for (const url of warmUrls([...quartierNames.keys()], [...communeNames.keys()])) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api${url}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      await res.arrayBuffer();
      if (!res.ok) failed += 1;
    } catch {
      failed += 1;
    }
    count += 1;
    // Yield so that real visitors are served between warm-up requests.
    await new Promise((r) => setTimeout(r, 2));
  }
  logger.info(
    { count, failed, ms: Date.now() - started },
    "Response cache warmed",
  );
}
