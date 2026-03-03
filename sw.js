// scramjet/sw.js
// Only intercept Scramjet proxy traffic; bypass everything else.
// Includes special case for Scramjet wasm wrapper request.

importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = self.$scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker({ prefix: "/scramjet/service/" });

let configLoaded = false;

// Scramjet UI files: bypass so they load normally
const UI_BYPASS_EXACT = new Set([
  "/",
  "/index.html",
  "/index.js",
  "/index.css",
  "/register-sw.js",
  "/search.js",
  "/config.js",
  "/404.html",
  "/credits.html",
  "/favicon.ico",
  "/sj.png",
  "/sw.js",
]);

// Infra/static folders that should fetch normally
const BYPASS_PREFIXES = [
  "/scram/",
  "/libcurl/",
  "/baremux/",
  "/favicon",
];

// OPTIONAL: add your own-site paths you *never* want Scramjet to touch
// (Only matters if your SW scope is accidentally too broad.)
const MAIN_SITE_BYPASS_PREFIXES = [
  // "/api/",
  // "/assets/",
  // "/static/",
];

function shouldBypass(url) {
  const p = url.pathname;
  const sameOrigin = url.origin === self.location.origin;

  // If SW scope ever becomes too broad, do NOT intercept normal site traffic.
  // Only allow Scramjet paths to be handled.
  if (sameOrigin) {
    const isScramjetArea =
      p.startsWith("/") ||
      p.startsWith("/scram/") ||
      p.startsWith("/libcurl/") ||
      p.startsWith("/baremux/");

    if (!isScramjetArea) return true;
  }

  // Never bypass proxied traffic
  if (p.startsWith("/scramjet/service/")) return false;

  // Never bypass Scramjet’s wasm wrapper request
  if (p === "/scram/scramjet.wasm.wasm") return false;

  // Bypass Scramjet UI files
  if (UI_BYPASS_EXACT.has(p)) return true;

  // Extra bypass for your main site (only matters if scope is wrong / too wide)
  if (sameOrigin) {
    for (const prefix of MAIN_SITE_BYPASS_PREFIXES) {
      if (p === prefix || p.startsWith(prefix)) return true;
    }
  }

  // Bypass infra/static folders
  for (const prefix of BYPASS_PREFIXES) {
    if (p === prefix || p.startsWith(prefix)) return true;
  }

  return false;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event));
});

async function handleFetch(event) {
  try {
    const url = new URL(event.request.url);

    if (shouldBypass(url)) return fetch(event.request);

    if (!configLoaded) {
      await scramjet.loadConfig();
      configLoaded = true;
    }

    if (scramjet.route(event)) return await scramjet.fetch(event);

    return fetch(event.request);
  } catch (err) {
    console.error("[SW] scramjet.fetch failed:", err);
    return new Response(`Scramjet SW error: ${err?.message ?? String(err)}`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
