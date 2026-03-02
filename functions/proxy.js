const LINK_TXT = "http://cloudflarelink.duckdns.org:8787/link.txt";
let cachedBase = null;
let cachedAt = 0;
const CACHE_MS = 10_000;

async function getUpstreamBase() {
  const now = Date.now();
  if (cachedBase && now - cachedAt < CACHE_MS) return cachedBase;

  const r = await fetch(LINK_TXT);
  if (!r.ok) throw new Error("Failed to fetch link.txt");

  const base = (await r.text()).trim().replace(/\/+$/, "");
  if (!base.startsWith("https://")) throw new Error("Invalid app tunnel URL");

  cachedBase = base;
  cachedAt = now;
  return base;
}

function isTextLike(contentType = "") {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith("text/") ||
    ct.includes("json") ||
    ct.includes("javascript") ||
    ct.includes("xml") ||
    ct.includes("svg")
  );
}

export async function handler(event) {
  try {
    // We pass original path via redirect query ?path=:splat
    const pathParam = event.queryStringParameters?.path ?? "";
    const origPath = "/" + pathParam.replace(/^\/+/, "");

    // Keep original querystring except our injected "path" param.
    // Netlify provides rawQuery like: "path=a/b&x=1"
    const rawQuery = event.rawQuery || "";
    const qs = rawQuery
      ? "?" +
        rawQuery
          .split("&")
          .filter((p) => !p.startsWith("path="))
          .join("&")
      : "";

    const upstreamBase = await getUpstreamBase();
    const upstreamUrl = upstreamBase + origPath + qs;

    // Clone request headers; remove hop-by-hop/host
    const headers = { ...event.headers };
    delete headers.host;

    // Body handling
    let body;
    if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
      if (event.isBase64Encoded) {
        body = Buffer.from(event.body || "", "base64");
      } else {
        body = event.body;
      }
    }

    const resp = await fetch(upstreamUrl, {
      method: event.httpMethod,
      headers,
      body,
      redirect: "manual",
    });

    const respHeaders = Object.fromEntries(resp.headers.entries());
    respHeaders["cache-control"] = "no-store, max-age=0";

    const contentType = resp.headers.get("content-type") || "";
    const buf = Buffer.from(await resp.arrayBuffer());

    // Return binary as base64 when needed (wasm, images, etc.)
    const textLike = isTextLike(contentType);
    return {
      statusCode: resp.status,
      headers: respHeaders,
      body: textLike ? buf.toString("utf8") : buf.toString("base64"),
      isBase64Encoded: !textLike,
    };
  } catch (err) {
    return { statusCode: 500, body: String(err?.message || err) };
  }
}
