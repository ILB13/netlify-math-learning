// netlify/edge-functions/proxy.ts

const LINK_TXT = "http://cloudflarelink.duckdns.org:8787/link.txt";

let cachedBase: string | null = null;
let cachedAt = 0;
const CACHE_MS = 10_000;

// Serve these from Netlify (repo/static), NOT proxied.
// IMPORTANT: include service worker + bare-mux related endpoints so they install/boot locally.
const STATIC_BYPASS = [
  // scramjet/bare-mux static folders
  "/scramjet",
  "/scram/",
  "/libcurl/",
  "/baremux/",
  "/bare-mux/",

  // service worker + related files (commonly required for bare-mux stacks)
  "/sw.js",
  "/sw.js.map",
  "/service-worker.js",
  "/worker.js",
  "/manifest.webmanifest",
];

async function getUpstreamBase(): Promise<string> {
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

export default async function handler(request: Request, context: any) {
  const url = new URL(request.url);
  const path = url.pathname;

  // ✅ Bypass (serve locally)
  const bypass = STATIC_BYPASS.some(
    (prefix) => path === prefix || path.startsWith(prefix),
  );
  if (bypass) {
    return context.next();
  }

  // ✅ Proxy everything else
  const upstreamBase = await getUpstreamBase();
  const upstreamUrl = upstreamBase + path + url.search;

  const headers = new Headers(request.headers);
  headers.delete("host");

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const resp = await fetch(upstreamUrl, {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });

  const respHeaders = new Headers(resp.headers);

  // Same behavior as your Cloudflare snippet
  respHeaders.set("cache-control", "no-store, max-age=0");

  // Optional: keep redirects on your Netlify domain (helps some apps)
  // If you don't want this, you can delete this block.
  const loc = respHeaders.get("location");
  if (loc) {
    try {
      const upstream = new URL(upstreamBase);
      const resolved = new URL(loc, upstreamBase);
      if (resolved.origin === upstream.origin) {
        resolved.protocol = url.protocol;
        resolved.host = url.host;
        respHeaders.set("location", resolved.toString());
      }
    } catch {
      // ignore invalid location headers
    }
  }

  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}
