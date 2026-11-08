import assert from "node:assert/strict";
import { test } from "node:test";
import { umamiTag, withUmami } from "./umami";

const URL = "https://stats.example.fr/script.js";
const ID = "0f6a1b2c-3d4e-5f60-7182-93a4b5c6d7e8";

test("without both variables there is no tag and no warning", () => {
  assert.deepEqual(umamiTag({}), { tag: "" });
  assert.equal(umamiTag({ UMAMI_SCRIPT_URL: URL }).tag, "");
  assert.equal(umamiTag({ UMAMI_WEBSITE_ID: ID }).tag, "");
});

test("one variable alone gives a warning", () => {
  assert.match(umamiTag({ UMAMI_SCRIPT_URL: URL }).warning ?? "", /UMAMI_WEBSITE_ID/);
  assert.match(umamiTag({ UMAMI_WEBSITE_ID: ID }).warning ?? "", /UMAMI_SCRIPT_URL/);
});

test("the tag loads the script without blocking the page, sends no automatic page view and honours Do Not Track", () => {
  const { tag, warning } = umamiTag({ UMAMI_SCRIPT_URL: URL, UMAMI_WEBSITE_ID: ID });
  assert.equal(warning, undefined);
  assert.equal(
    tag,
    `<script async src="${URL}" data-website-id="${ID}" data-auto-track="false" data-do-not-track="true" data-exclude-search="true"></script>`,
  );
});

test("UMAMI_DOMAINS limits the hosts that send data", () => {
  const { tag } = umamiTag({ UMAMI_SCRIPT_URL: URL, UMAMI_WEBSITE_ID: ID, UMAMI_DOMAINS: "prix.example.fr,www.prix.example.fr" });
  assert.match(tag, / data-domains="prix\.example\.fr,www\.prix\.example\.fr"><\/script>$/);
});

test("a value that is not a plain http(s) URL, id or host list gives no tag and a warning", () => {
  for (const env of [
    { UMAMI_SCRIPT_URL: "javascript:alert(1)", UMAMI_WEBSITE_ID: ID },
    { UMAMI_SCRIPT_URL: "not a url", UMAMI_WEBSITE_ID: ID },
    { UMAMI_SCRIPT_URL: `${URL}" onload="alert(1)`, UMAMI_WEBSITE_ID: ID },
    { UMAMI_SCRIPT_URL: URL, UMAMI_WEBSITE_ID: `${ID}"><script>` },
    { UMAMI_SCRIPT_URL: URL, UMAMI_WEBSITE_ID: ID, UMAMI_DOMAINS: `a.fr"><script>` },
  ]) {
    const r = umamiTag(env);
    assert.equal(r.tag, "", JSON.stringify(env));
    assert.ok(r.warning, JSON.stringify(env));
  }
});

test("withUmami puts the tag at the end of the head, and an empty tag leaves the page as it is", () => {
  const html = "<html><head><title>x</title></head><body></body></html>";
  assert.equal(withUmami(html, "<script></script>"), "<html><head><title>x</title><script></script></head><body></body></html>");
  assert.equal(withUmami(html, ""), html);
});
