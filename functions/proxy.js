// functions/proxy.js

// Always fetch the base URL from here:
const PAGE_LINK = "http://cloudflarelink.duckdns.org:8787/page_link.txt";

let cachedBase = null;
let cachedAt = 0;
const CACHE_MS = 10_000; // 10 seconds

async function getUpstreamBase() {
  const now = Date.now();
  if (cachedBase && now - cachedAt < CACHE_MS) return cachedBase;

  const res = await fetch(PAGE_LINK);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch page_link.txt: ${res.status} ${res.statusText}`
    );
  }

  const base = (await res.text()).trim().replace(/\/+$/, "");
  // Don't force https/http; just trust whatever page_link.txt returns.
  cachedBase = base;
  cachedAt = now;
  return base;
}

exports.handler = async function (event) {
  try {
    const upstreamBase = await getUpstreamBase();

    // We passed the original path as ?path=:splat in netlify.toml
    const qs = event.queryStringParameters || {};
    const { path: originalPathParam, ...restParams } = qs;

    // Rebuild the original path
    let path = originalPathParam || "/";
    if (!path.startsWith("/")) path = "/" + path;

    // Rebuild the rest of the query string (without the helper "path" param)
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(restParams)) {
      if (value != null) searchParams.append(key, value);
    }
    const queryString = searchParams.toString();

    const upstreamUrl =
      upstreamBase + path + (queryString ? `?${queryString}` : "");

    // 307: preserve method + body for fetch/POST/etc.
    // We do NOT stream any response body – we just tell the browser
    // to go directly to upstreamUrl.
    return {
      statusCode: 307,
      headers: {
        Location: upstreamUrl,
        "cache-control": "no-store, max-age=0",
      },
      body: "",
    };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, max-age=0",
      },
      body: JSON.stringify({ error: message }),
    };
  }
};
