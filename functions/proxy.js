// functions/proxy.js

// URL that returns the current tunnel base URL (same as Cloudflare version)
const LINK_TXT = "http://cloudflarelink.duckdns.org:8787/link.txt";

let cachedBase = null;
let cachedAt = 0;
const CACHE_MS = 10_000;

/**
 * Fetch and cache the upstream base URL (from link.txt).
 */
async function getUpstreamBase() {
  const now = Date.now();
  if (cachedBase && now - cachedAt < CACHE_MS) return cachedBase;

  const res = await fetch(LINK_TXT);
  if (!res.ok) {
    throw new Error(`Failed to fetch link.txt: ${res.status} ${res.statusText}`);
  }

  const base = (await res.text()).trim().replace(/\/+$/, "");

  // IMPORTANT: do NOT enforce https here – link.txt might return http://
  // We'll just trust whatever it gives us.
  cachedBase = base;
  cachedAt = now;
  return base;
}

/**
 * Netlify function handler (CommonJS export).
 *
 * netlify.toml redirects all non-Scramjet paths:
 *   /* -> /.netlify/functions/proxy
 * so event.path is the original URL path (/, /celeste/_framework/data/..., etc).
 */
exports.handler = async function (event) {
  try {
    const upstreamBase = await getUpstreamBase();

    // Original requested path on the site, e.g. "/", "/celeste/_framework/data/dataaa.data"
    const path = event.path || "/";

    // Rebuild query string from Netlify's queryStringParameters
    const params = event.queryStringParameters || {};
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null) searchParams.append(key, value);
    }
    const queryString = searchParams.toString();

    const upstreamUrl =
      upstreamBase + path + (queryString ? `?${queryString}` : "");

    // Copy incoming headers but strip hop-by-hop / Netlify-specific ones
    const headers = { ...(event.headers || {}) };
    delete headers.host;
    delete headers["x-forwarded-for"];
    delete headers["x-forwarded-host"];
    delete headers["x-forwarded-proto"];
    delete headers["x-nf-client-connection-ip"];
    delete headers["content-length"]; // Netlify recalculates this

    // Prepare body (handle base64-encoded body from Netlify)
    let body = undefined;
    if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
      if (event.body) {
        body = event.isBase64Encoded
          ? Buffer.from(event.body, "base64")
          : event.body;
      }
    }

    // Proxy the request to the upstream
    const resp = await fetch(upstreamUrl, {
      method: event.httpMethod,
      headers,
      body,
      redirect: "manual",
    });

    // Copy response headers
    const respHeaders = {};
    resp.headers.forEach((value, key) => {
      respHeaders[key.toLowerCase()] = value;
    });

    // We are re-encoding the body, so these MUST go
    delete respHeaders["content-length"];
    delete respHeaders["transfer-encoding"];

    // Avoid cached tunnel responses
    respHeaders["cache-control"] = "no-store, max-age=0";

    // Read response body as raw bytes
    const arrayBuffer = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    // Always return as base64 so we never corrupt wasm/.data/etc.
    return {
      statusCode: resp.status,
      headers: respHeaders,
      body: buf.toString("base64"),
      isBase64Encoded: true,
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
