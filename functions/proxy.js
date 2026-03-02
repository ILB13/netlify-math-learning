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
  // Don't force https – link.txt may return http://
  cachedBase = base;
  cachedAt = now;
  return base;
}

// Extensions that we should NOT stream through the function (too big)
const LARGE_BINARY_EXT = /\.(data|wasm|dll|pdb|bin)$/i;

/**
 * Netlify function handler (CommonJS export).
 *
 * netlify.toml redirects all non-Scramjet paths:
 *   /* -> /.netlify/functions/proxy
 */
exports.handler = async function (event) {
  try {
    const upstreamBase = await getUpstreamBase();

    // Original requested path on the site, e.g. "/",
    // "/celeste/_framework/data/dataaa.data", etc.
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

    // --- 1) BIG BINARY ASSETS -> REDIRECT, **DON'T** STREAM THROUGH FUNCTION ---

    if (
      path.startsWith("/celeste/") || // Celeste game assets
      LARGE_BINARY_EXT.test(path)     // any *.data, *.wasm, etc
    ) {
      return {
        statusCode: 302,
        headers: {
          Location: upstreamUrl,
          // Avoid caching in case the tunnel URL changes
          "cache-control": "no-store, max-age=0",
        },
        body: "",
      };
    }

    // --- 2) EVERYTHING ELSE -> NORMAL PROXY THROUGH FUNCTION ---

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

    // Read response body as raw bytes, then send as base64.
    const arrayBuffer = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

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
