import assert from "node:assert/strict";
import { test } from "node:test";
import { previewTags, siteUrl } from "./pageMeta";

test("siteUrl keeps an https origin and removes a trailing slash", () => {
  assert.deepEqual(siteUrl({ SITE_URL: "https://parism2.gpuphysics.dev/" }), { url: "https://parism2.gpuphysics.dev" });
});

test("siteUrl refuses a missing value, http, a path and quotes, with a warning", () => {
  for (const v of [undefined, "http://parism2.gpuphysics.dev", "https://x.dev/path", 'https://x.dev"><script>']) {
    const r = siteUrl({ SITE_URL: v });
    assert.equal(r.url, "", String(v));
    assert.match(r.warning ?? "", /link previews have no image/, String(v));
  }
});

test("previewTags gives the absolute image and its size", () => {
  const tags = previewTags("https://parism2.gpuphysics.dev");
  assert.ok(tags.includes('<meta property="og:image" content="https://parism2.gpuphysics.dev/og-image.png">'), tags);
  assert.ok(tags.includes('<meta property="og:url" content="https://parism2.gpuphysics.dev/">'), tags);
  assert.ok(tags.includes('content="1200"') && tags.includes('content="630"'), tags);
  assert.ok(tags.includes('<meta name="twitter:image" content="https://parism2.gpuphysics.dev/og-image.png">'), tags);
  assert.equal(previewTags(""), "");
});
