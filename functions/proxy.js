// functions/proxy.js

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

    // Original requested path, e.g. "/celeste/_framework/data/dataaa.data"
    const path = event.path || "/";

    // Rebuild query string
    const params = event.queryStringParameters || {};
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null) searchParams.append(key, value);
    }
    const queryString = searchParams.toString();

    const upstreamUrl =
      upstreamBase + path + (queryString ? `?${queryString}` : "");

    // 307: preserve method + body for fetch/POST/etc.
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
