// functions/proxy.js

// This is the URL that returns the *page* base URL you want to proxy to.
const PAGE_LINK = "http://cloudflarelink.duckdns.org:8787/page_link.txt";

let cachedBase = null;
let cachedAt = 0;
const CACHE_MS = 10_000; // 10 seconds

// Extensions that are likely to be big binary blobs
const LARGE_BINARY_EXT = /\.(data|wasm|dll|pdb|bin)$/i;

/**
 * Fetch and cache the upstream base URL (from page_link.txt).
 */
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

/**
 * Netlify function handler.
 *
 * netlify.toml sends everything except the Scramjet static paths here:
 *   from = "/*"
 *   to   = "/.netlify/functions/proxy?path=:splat"
 */
exports.handler = async function (event) {
  try {
    const upstreamBase = await getUpstreamBase();

    // ORIGINAL PATH comes from ?path=:splat
    const qs = event.queryStringParameters || {};
    const { path: originalPathParam, ...restParams } = qs;

    let path = originalPathParam || "/";
    if (!path.startsWith("/")) path = "/" + path;

    // Rebuild query string WITHOUT the helper "path" param
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(restParams)) {
      if (value != null) searchParams.append(key, value);
    }
    const queryString = searchParams.toString();

    const upstreamUrl =
      upstreamBase + path + (queryString ? `?${queryString}` : "");

    // ----------------------------------------------------
    // 1) BIG BINARY / CELESTE ASSETS:
    //    Don't stream them through the function at all.
    //    Just redirect the browser straight to the upstream.
    // ----------------------------------------------------
    if (
      path.startsWith("/celeste/") || // Celeste game stuff
      LARGE_BINARY_EXT.test(path)     // *.data, *.wasm, *.dll, etc.
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

    // ----------------------------------------------------
    // 2) EVERYTHING ELSE:
    //    Proxy through the function (all "normal" fetches/pages),
    //    using the base URL from page_link.txt.
    // ----------------------------------------------------

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

    // Read response body as raw bytes, then send as base64
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
