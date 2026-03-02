const LINK_TXT = "http://cloudflarelink.duckdns.org:8787/link.txt";
let cachedBase = null;
let cachedAt = 0;
const CACHE_MS = 10_000;

// These paths serve Scramjet static files directly from the repo
const SCRAMJET_STATIC = [
  "/scramjet",
  "/scram/",
  "/libcurl/",
  "/baremux/",
];

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

export async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);
  const path = url.pathname;

  // Serve Scramjet static files directly, don't proxy them
  const isScramjet = SCRAMJET_STATIC.some(prefix =>
    path === prefix || path.startsWith(prefix)
  );
  if (isScramjet) {
    return context.next();
  }

  // Everything else gets proxied to your main app
  const upstreamBase = await getUpstreamBase();
  const upstreamUrl = upstreamBase + path + url.search;
  const headers = new Headers(req.headers);
  headers.delete("host");
  const resp = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    redirect: "manual",
  });
  const respHeaders = new Headers(resp.headers);
  respHeaders.set("cache-control", "no-store, max-age=0");
  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}
