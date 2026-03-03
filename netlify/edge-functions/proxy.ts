const LINK_TXT = "http://cloudflarelink.duckdns.org:8787/link.txt";

let cachedBase: string | null = null;
let cachedAt = 0;
const CACHE_MS = 10_000;

// Serve these from Netlify (repo/static), NOT proxied
const SCRAMJET_STATIC = [
  "/scramjet",
  "/scram/",
  "/libcurl/",
  "/baremux/",
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

  // ✅ Scramjet static: let Netlify serve files directly
  const isScramjet = SCRAMJET_STATIC.some(
    (prefix) => path === prefix || path.startsWith(prefix),
  );
  if (isScramjet) {
    return context.next();
  }

  // ✅ Everything else: proxy to upstream
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
  // same as your CF code
  respHeaders.set("cache-control", "no-store, max-age=0");

  return new Response(resp.body, { status: resp.status, headers: respHeaders });
}
