(function () {
  "use strict";

  const DB_NAME = "ssv-files";
  const STORE_NAME = "files";
  const RELOAD_KEY = "ssv-sw-reload-once";
  const RESERVED_PATHS = new Set([
    "/SSV_config.html",
    "/styles.css",
    "/ssv-app.js",
    "/sw.js",
    "/favicon.ico"
  ]);

  const MIME_BY_EXT = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".xml": "application/xml; charset=utf-8",
    ".wasm": "application/wasm"
  };

  const APP_BASE_PATH = detectBasePath();

  function detectBasePath() {
    const scriptUrl = document.currentScript && document.currentScript.src
      ? document.currentScript.src
      : new URL("./", window.location.href).toString();
    const path = new URL("./", scriptUrl).pathname;
    return path.endsWith("/") ? path : `${path}/`;
  }

  function appUrl(path) {
    const clean = path.startsWith("/") ? path.slice(1) : path;
    return new URL(clean, `${window.location.origin}${APP_BASE_PATH}`).toString();
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
        // Keep original path if decode fails.
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

  function stripBasePath(pathname) {
    const normalizedPath = normalizePath(pathname, { decode: true });
    const normalizedBase = normalizePath(APP_BASE_PATH);
    if (normalizedBase === "/") {
      return normalizedPath;
    }
    if (normalizedPath === normalizedBase) {
      return "/";
    }
    if (normalizedPath.startsWith(`${normalizedBase}/`)) {
      return normalizedPath.slice(normalizedBase.length);
    }
    return normalizedPath;
  }

  function contentTypeForPath(path) {
    const lower = path.toLowerCase();
    for (const ext of Object.keys(MIME_BY_EXT)) {
      if (lower.endsWith(ext)) {
        return MIME_BY_EXT[ext];
      }
    }
    return "application/octet-stream";
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

  async function withStore(mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = callback(store, tx);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }).finally(() => db.close());
  }

  async function putMany(files) {
    return withStore("readwrite", (store) => {
      for (const file of files) {
        store.put(file);
      }
    });
  }

  async function getAllRecords() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function clearAllRecords() {
    return withStore("readwrite", (store) => {
      store.clear();
    });
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    await navigator.serviceWorker.register(appUrl("sw.js"), { scope: APP_BASE_PATH });

    if (!navigator.serviceWorker.controller) {
      const keyValue = sessionStorage.getItem(RELOAD_KEY);
      const reloadKey = `${APP_BASE_PATH}:${location.pathname}`;
      if (keyValue !== reloadKey) {
        sessionStorage.setItem(RELOAD_KEY, reloadKey);
        await navigator.serviceWorker.ready;
        location.reload();
      }
    } else {
      sessionStorage.removeItem(RELOAD_KEY);
    }
  }

  function showStatus(text, isError) {
    const el = document.getElementById("status");
    if (!el) {
      return;
    }
    el.textContent = text || "";
    el.style.color = isError ? "#b91c1c" : "#065f46";
  }

  function humanSize(size) {
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderFileList(records) {
    const list = document.getElementById("file-list");
    if (!list) {
      return;
    }

    list.textContent = "";
    if (!records.length) {
      const li = document.createElement("li");
      li.textContent = "No uploaded files.";
      list.appendChild(li);
      return;
    }

    records
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .forEach((record) => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = appUrl(record.path);
        link.textContent = record.path;
        li.appendChild(link);

        const meta = document.createElement("span");
        meta.textContent = ` (${humanSize(record.size || 0)})`;
        li.appendChild(meta);

        list.appendChild(li);
      });
  }

  async function refreshFiles() {
    const records = await getAllRecords();
    renderFileList(records);
    return records;
  }

  async function parseSingleFile(file) {
    const path = normalizePath(file.name);
    if (RESERVED_PATHS.has(path)) {
      throw new Error(`"${path}" is reserved by the app and cannot be replaced.`);
    }

    const blob = file.slice(0, file.size, file.type || contentTypeForPath(path));
    return [{
      path,
      type: blob.type || contentTypeForPath(path),
      size: blob.size,
      blob,
      updatedAt: Date.now()
    }];
  }

  async function parseZipFile(file) {
    if (!window.JSZip) {
      throw new Error("ZIP support failed to load.");
    }

    const zip = await window.JSZip.loadAsync(file);
    const output = [];
    const names = Object.keys(zip.files);

    for (const name of names) {
      const entry = zip.files[name];
      if (entry.dir) {
        continue;
      }

      const path = normalizePath(entry.name);
      if (RESERVED_PATHS.has(path)) {
        continue;
      }

      const bytes = await entry.async("uint8array");
      const type = contentTypeForPath(path);
      output.push({
        path,
        type,
        size: bytes.byteLength,
        blob: new Blob([bytes], { type }),
        updatedAt: Date.now()
      });
    }

    if (!output.length) {
      throw new Error("ZIP file had no uploadable files.");
    }

    return output;
  }

  async function collectUploads(file) {
    if (file.name.toLowerCase().endsWith(".zip") || file.type.includes("zip")) {
      return parseZipFile(file);
    }
    return parseSingleFile(file);
  }

  async function handleUpload(event) {
    event.preventDefault();
    const input = document.getElementById("upload-file");
    if (!input || !input.files || !input.files.length) {
      showStatus("Pick a file first.", true);
      return;
    }

    const file = input.files[0];
    showStatus("Processing upload...", false);

    try {
      const uploads = await collectUploads(file);
      await putMany(uploads);
      const records = await refreshFiles();
      showStatus(`Added ${uploads.length} file(s). Total stored: ${records.length}.`, false);

      if (stripBasePath(location.pathname) === "/" && records.some((r) => r.path === "/index.html")) {
        location.reload();
      }
    } catch (error) {
      showStatus(error.message || "Upload failed.", true);
    }
  }

  async function initConfigPage() {
    const clearBtn = document.getElementById("clear-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        const confirmed = window.confirm("Clear all uploaded files?");
        if (!confirmed) {
          return;
        }

        await clearAllRecords();
        await refreshFiles();
        showStatus("All uploaded files were cleared.", false);
      });
    }
  }

  async function initViewerPage() {
    const pathEl = document.getElementById("current-path");
    if (pathEl) {
      pathEl.textContent = stripBasePath(location.pathname);
    }
  }

  async function init() {
    try {
      await registerServiceWorker();
    } catch (error) {
      showStatus(`Service worker failed: ${error.message || error}`, true);
    }

    const form = document.getElementById("upload-form");
    if (form) {
      form.addEventListener("submit", handleUpload);
    }

    await refreshFiles();

    const page = document.body.getAttribute("data-page");
    if (page === "config") {
      await initConfigPage();
    } else {
      await initViewerPage();
    }
  }

  init().catch((error) => {
    showStatus(error.message || "Unexpected error.", true);
  });
})();
