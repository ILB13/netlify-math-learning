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
const wispUrl = "wss://66.23.224.198:8080/wisp/";

// Auto-navigate if coming from main page
scramjet.init().then(() => {
  const goto = sessionStorage.getItem("scramjet_goto");
  if (goto) {
    sessionStorage.removeItem("scramjet_goto");
    registerSW().then(async () => {
      if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
        await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
      }
      window.location.href = scramjet.encodeUrl(goto);
    }).catch(err => {
      error.textContent = "Failed to register service worker.";
      errorCode.textContent = err.toString();
    });
  }
});

// Manual form submit on /scramjet/ page
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await registerSW();
  } catch (err) {
    error.textContent = "Failed to register service worker.";
    errorCode.textContent = err.toString();
    throw err;
  }
  const url = search(address.value, searchEngine.value);
  if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
    await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
  }
  window.location.href = scramjet.encodeUrl(url);
});
