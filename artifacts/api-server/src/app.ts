import path from "node:path";
import express, { type Express, type Router } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import { ZodError } from "zod";
import { responseCache } from "./lib/responseCache";
import { logger } from "./lib/logger";
import { loadPage, umamiTag } from "./lib/umami";
import { previewTags, siteUrl } from "./lib/pageMeta";

/** Builds the server around the API routes. The routes are passed in so that tests can build it without the Sales file. */
export function createApp(router: Router, env: NodeJS.ProcessEnv = process.env): Express {
  const app: Express = express();

  // The DVF reuse conditions forbid indexing by search engines (docs/adr/0006-public-site-limits.md). robots.txt lets
  // preview bots read the page, so this header and the robots meta tag do the blocking, on every response.
  app.use((_req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors());
  app.use(compression());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", responseCache, router);

  // Optional: serve the built dashboard from this server (used for self-hosting).
  // Set STATIC_DIR to the folder that contains index.html.
  const staticDir = env["STATIC_DIR"];
  if (staticDir) {
    const root = path.resolve(staticDir);
    // The page is read once, with the analytics tag when Umami is configured (lib/umami.ts) and the link preview tags
    // when SITE_URL is set (lib/pageMeta.ts).
    const umami = umamiTag(env);
    if (umami.warning) logger.warn(umami.warning);
    const site = siteUrl(env);
    if (site.warning) logger.warn(site.warning);
    const { page, error } = loadPage(path.join(root, "index.html"), umami.tag + previewTags(site.url));
    if (error) logger.error(error);
    const sendPage = (_req: express.Request, res: express.Response) => {
      if (page === null) { res.status(404).end(); return; }
      res.set("Cache-Control", "no-cache").type("html").send(page);
    };
    app.get("/index.html", sendPage);
    app.use(express.static(root, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, sendPage);
  }

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Invalid request", issues: err.issues });
        return;
      }
      req.log.error({ err }, "Unhandled error");
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
