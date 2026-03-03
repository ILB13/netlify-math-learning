// netlify/edge-functions/proxy.ts

const LINK_TXT = "http://cloudflarelink.duckdns.org:8787/link.txt";

let cachedBase: string | null = null;
let cachedAt = 0;
const CACHE_MS = 10_000;

// Anything in here is served locally (NOT proxied).
// Keep scramjet + bare-mux + service worker files local.
const STATIC_BYPASS = [
  "/scramjet",
  "/scram/",
  "/libcurl/",
  "/baremux/",
  "/bare-mux/",

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

function withRequiredHeaders(reqUrl: URL, res: Response): Response {
  const h = new Headers(res.headers);

  // Don’t cache (matches your Pages behavior)
  h.set("cache-control", "no-store, max-age=0");

  // ✅ Required for SharedWorker/SAB-style stacks (bare-mux often needs this)
  h.set("Cross-Origin-Opener-Policy", "same-origin");

  // Try credentialless first (less painful for assets).
  // If something breaks, change to "require-corp".
  h.set("Cross-Origin-Embedder-Policy", "credentialless");

  // Helpful additions for isolation / consistency
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set("Origin-Agent-Cluster", "?1");

  // If this is the service worker script, allow wide scope
  if (reqUrl.pathname === "/sw.js" || reqUrl.pathname === "/service-worker.js") {
    h.set("Service-Worker-Allowed", "/");
    // Ensure it's treated as JS (avoids weird MIME issues)
    if (!h.get("content-type")) {
      h.set("content-type", "application/javascript; charset=utf-8");
    }
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}

export default async function handler(request: Request, context: any) {
  const url = new URL(request.url);
  const path = url.pathname;

  const bypass = STATIC_BYPASS.some((p) => path === p || path.startsWith(p));
  if (bypass) {
    const res = await context.next();
    return withRequiredHeaders(url, res);
  }

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

  // Rewrite upstream redirects back onto your Netlify domain (optional but often helps)
  const outHeaders = new Headers(resp.headers);
  const loc = outHeaders.get("location");
  if (loc) {
    try {
      const resolved = new URL(loc, upstreamBase);
      const up = new URL(upstreamBase);
      if (resolved.origin === up.origin) {
        resolved.protocol = url.protocol;
        resolved.host = url.host;
        outHeaders.set("location", resolved.toString());
      }
    } catch {
      // ignore
    }
  }

  const out = new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: outHeaders,
  });

  return withRequiredHeaders(url, out);
}
