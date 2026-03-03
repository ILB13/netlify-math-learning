const PAGE_LINK_TXT = "http://cloudflarelink.duckdns.org:8787/page_link.txt";

// Cache upstream base for 10s (same idea as your CF code)
let cachedBase: string | null = null;
let cachedAt = 0;
const CACHE_MS = 10_000;

async function getUpstreamBase(): Promise<string> {
  const now = Date.now();
  if (cachedBase && now - cachedAt < CACHE_MS) return cachedBase;

  const r = await fetch(PAGE_LINK_TXT);
  if (!r.ok) throw new Error("Failed to fetch page_link.txt");

  const base = (await r.text()).trim().replace(/\/+$/, "");
  // No https-only restriction since you said "ALL fetches"
  if (!/^https?:\/\//i.test(base)) throw new Error("Invalid upstream base URL");

  cachedBase = base;
  cachedAt = now;
  return base;
}

function rewriteLocation(location: string, upstreamBase: string, thisOrigin: string) {
  // If upstream redirects to itself, rewrite to your Netlify origin
  try {
    const loc = new URL(location, upstreamBase);
    const up = new URL(upstreamBase);
    if (loc.origin === up.origin) {
      loc.protocol = new URL(thisOrigin).protocol;
      loc.host = new URL(thisOrigin).host;
      return loc.toString();
    }
  } catch {}
  return location;
}

export default async function handler(request: Request) {
  const url = new URL(request.url);

  const upstreamBase = await getUpstreamBase();
  const upstreamUrl = upstreamBase + url.pathname + url.search;

  const headers = new Headers(request.headers);
  headers.delete("host"); // let fetch set it

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const upstreamResp = await fetch(upstreamUrl, {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });

  const respHeaders = new Headers(upstreamResp.headers);

  // Optional but usually helpful for proxy setups:
  // - avoid caching issues while you debug
  respHeaders.set("cache-control", "no-store, max-age=0");

  // Fix redirects so the browser stays on your Netlify domain
  const loc = respHeaders.get("location");
  if (loc) {
    respHeaders.set("location", rewriteLocation(loc, upstreamBase, url.origin));
  }

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    headers: respHeaders,
  });
}
