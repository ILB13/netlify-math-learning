// scramjet/index.js
// Redirect-only version (no iframe, no new tabs).
// Ensures SW + transport are ready, then navigates in the same tab.

"use strict";

const form = document.getElementById("sj-form");
const address = document.getElementById("sj-address");
const searchEngine = document.getElementById("sj-search-engine");
const error = document.getElementById("sj-error");
const errorCode = document.getElementById("sj-error-code");

const { ScramjetController } = $scramjetLoadController();
const scramjet = new ScramjetController({
  prefix: "/scramjet/service/",
  files: {
    wasm: "/scram/scramjet.wasm.wasm",
    all: "/scram/scramjet.all.js",
    sync: "/scram/scramjet.sync.js",
  },
});

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

// Default WISP URL (override with ?wisp=wss://.../wisp/)
function getWispUrl() {
  const u = new URL(location.href);
  const fromQuery = u.searchParams.get("wisp");
  const fromStorage = localStorage.getItem("wispUrl");
  const fallback = "wss://wisp.mercurywork.shop/wisp/";
  const wispUrl = (fromQuery || fromStorage || fallback).trim();
  localStorage.setItem("wispUrl", wispUrl);
  return wispUrl;
}

const wispUrl = getWispUrl();

/**
 * Ensure libcurl transport is set and re-applied when the WISP URL changes.
 * Pass BOTH keys (wisp + websocket) to cover differing builds.
 */
async function ensureTransport() {
  const current = await connection.getTransport();
  const last = localStorage.getItem("scramjet_wisp_url");

  if (current !== "/libcurl/index.mjs" || last !== wispUrl) {
    await connection.setTransport("/libcurl/index.mjs", [{ wisp: wispUrl, websocket: wispUrl }]);
    localStorage.setItem("scramjet_wisp_url", wispUrl);
  }
}

async function ensureControlled() {
  await registerSW();
  await navigator.serviceWorker.ready;

  // If not controlled yet, reload once and use sessionStorage to resume.
  if (!navigator.serviceWorker.controller) {
    const pending = sessionStorage.getItem("scramjet_goto");
    // If nothing pending, don't loop
    if (!pending) return false;
    location.reload();
    return false;
  }
  return true;
}

async function go(targetUrl) {
  // Store in case we need to reload to get controller
  sessionStorage.setItem("scramjet_goto", targetUrl);

  const ok = await ensureControlled();
  if (!ok) return;

  await ensureTransport();

  // Clear once we're about to navigate
  sessionStorage.removeItem("scramjet_goto");

  // Redirect in the same tab
  const encoded = scramjet.encodeUrl(targetUrl);
  window.location.replace(encoded);
}

// Auto-navigate if coming from main page OR after reload
scramjet.init().then(() => {
  const goto = sessionStorage.getItem("scramjet_goto");
  if (goto) go(goto).catch((err) => {
    error.textContent = "Navigation failed.";
    errorCode.textContent = err.toString();
  });
});

// Manual form submit on /scramjet/ page
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const url = search(address.value, searchEngine.value);
    await go(url);
  } catch (err) {
    error.textContent = "Failed to start navigation.";
    errorCode.textContent = err.toString();
    throw err;
  }
});
