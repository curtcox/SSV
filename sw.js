"use strict";

const DB_NAME = "ssv-files";
const STORE_NAME = "files";
const RESERVED_PATHS = new Set([
  "/SSV_config.html",
  "/404.html",
  "/styles.css",
  "/ssv-app.js",
  "/sw.js",
  "/favicon.ico"
]);

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const path = normalizePath(url.pathname, { decode: true });
  if (RESERVED_PATHS.has(path)) {
    return;
  }

  event.respondWith(handleFetch(request, path));
});

function normalizePath(inputPath, options) {
  const shouldDecode = Boolean(options && options.decode);
  if (!inputPath || typeof inputPath !== "string") {
    return "/";
  }

  let path = inputPath.trim();
  if (shouldDecode) {
    try {
      path = decodeURIComponent(path);
    } catch (error) {
      // Ignore decode errors and keep original path text.
    }
  }

  path = path.replaceAll("\\", "/");
  path = path.replace(/\/+/g, "/");

  const pieces = path.split("/");
  const normalized = [];
  for (const piece of pieces) {
    if (!piece || piece === ".") {
      continue;
    }
    if (piece === "..") {
      if (normalized.length) {
        normalized.pop();
      }
      continue;
    }
    normalized.push(piece);
  }

  return normalized.length ? `/${normalized.join("/")}` : "/";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "path" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRecord(path) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(path);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

function responseFromRecord(record) {
  const headers = new Headers();
  if (record.type) {
    headers.set("Content-Type", record.type);
  }
  headers.set("X-SSV-Source", "indexeddb");
  return new Response(record.blob, { status: 200, headers });
}

async function handleFetch(request, path) {
  const lookupPaths = path === "/" ? ["/index.html"] : [path];
  for (const candidate of lookupPaths) {
    const record = await getRecord(candidate);
    if (record) {
      return responseFromRecord(record);
    }
  }

  if (request.mode === "navigate" && path !== "/" && path !== "/index.html") {
    const fallback = await fetch("/404.html", { cache: "no-store" });
    if (fallback.ok) {
      return new Response(await fallback.text(), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  return fetch(request);
}
