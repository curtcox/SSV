"use strict";

const DB_NAME = "ssv-files";
const STORE_NAME = "files";
const RESERVED_PATHS = new Set([
  "/SSV_config.html",
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

  const path = scopedPath(url.pathname);
  if (path === null || RESERVED_PATHS.has(path)) {
    return;
  }

  event.respondWith(handleFetch(request, path));
});

function scopePath() {
  return normalizePath(new URL(self.registration.scope).pathname, { decode: true });
}

function scopedPath(urlPathname) {
  const fullPath = normalizePath(urlPathname, { decode: true });
  const basePath = scopePath();
  if (basePath === "/") {
    return fullPath;
  }
  if (fullPath === basePath) {
    return "/";
  }
  if (fullPath.startsWith(`${basePath}/`)) {
    return fullPath.slice(basePath.length);
  }
  return null;
}

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

function scopeUrl(fileName) {
  return new URL(fileName, self.registration.scope).toString();
}

function notFoundResponse() {
  const configUrl = scopeUrl("SSV_config.html");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>Not Found</h1><p>Path not found in uploaded files.</p><p><a href="${configUrl}">Open SSV_config.html</a></p></body></html>`,
    {
      status: 404,
      statusText: "Not Found",
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }
  );
}

async function handleFetch(request, path) {
  const lookupPaths = [];
  if (path === "/") {
    lookupPaths.push("/index.html");
  } else if (path.endsWith("/")) {
    lookupPaths.push(`${path}index.html`);
  } else {
    lookupPaths.push(path);
  }

  for (const candidate of lookupPaths) {
    const record = await getRecord(candidate);
    if (record) {
      return responseFromRecord(record);
    }
  }

  if (request.mode === "navigate" && path.endsWith("/") === false) {
    const directoryIndex = await getRecord(`${path}/index.html`);
    if (directoryIndex) {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `${redirectUrl.pathname}/`;
      return Response.redirect(redirectUrl.toString(), 301);
    }
  }

  if (request.mode === "navigate" && path !== "/" && path !== "/index.html") {
    return notFoundResponse();
  }

  return fetch(request);
}
