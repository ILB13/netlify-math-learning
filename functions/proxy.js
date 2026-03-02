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
  if (!base.startsWith("https://")) {
    throw new Error("Invalid app tunnel URL");
  }

  cachedBase = base;
  cachedAt = now;
  return base;
}

/**
 * Simple "is this probably text" check based on Content-Type.
 * Only safe to use when the response is *not* compressed.
 */
function isTextLike(contentType) {
  if (!contentType) return false;
  contentType = contentType.toLowerCase();

  if (contentType.startsWith("text/")) return true;

  const textTypes = [
    "application/json",
    "application/javascript",
    "application/x-javascript",
    "application/xml",
    "application/x-www-form-urlencoded",
    "image/svg+xml",
  ];

  return textTypes.some((t) => contentType.startsWith(t));
}

/**
 * Netlify function handler (CommonJS export).
 *
 * netlify.toml redirects all non-Scramjet paths:
 *   /* -> /.netlify/functions/proxy
 * so event.path is the original URL path (/, /presence/..., etc).
 */
exports.handler = async function (event) {
  try {
    const upstreamBase = await getUpstreamBase();

    // Original requested path on the site, e.g. "/", "/presence/ping"
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
    delete headers["content-length"]; // Netlify will set this itself

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
      respHeaders[key] = value;
    });

    // Avoid cached tunnel responses
    respHeaders["cache-control"] = "no-store, max-age=0";

    const contentType = resp.headers.get("content-type") || "";
    const contentEncoding = resp.headers.get("content-encoding") || "";
    const isCompressed =
      contentEncoding && contentEncoding.toLowerCase() !== "identity";

    // Only treat as text if it's text-like AND not compressed
    const textLike = isTextLike(contentType) && !isCompressed;

    // Read response body
    const arrayBuffer = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    return {
      statusCode: resp.status,
      headers: respHeaders,
      body: textLike ? buf.toString("utf8") : buf.toString("base64"),
      isBase64Encoded: !textLike,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: String(err && err.message ? err.message : err),
    };
  }
};
