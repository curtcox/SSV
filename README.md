# SSV

Static Site Viewer (client-only).

## What It Does

- Accepts either one file or one ZIP upload.
- Uses uploaded file name (or ZIP entry path) as the URL path.
- Persists uploaded files in IndexedDB.
- Adds files incrementally instead of wiping prior uploads.
- Serves files through a service worker so they load by path.
- Provides `/SSV_config.html` to add more files or clear all stored content.

## Create A Compatible ZIP

Rules:

- The ZIP should contain your site files at the ZIP root.
- Do not wrap everything inside an extra top-level folder unless you want that folder in the URL path.
- Paths inside the ZIP are the URL paths used by SSV.

Example:

- `index.html` -> `/index.html` (and `/`)
- `blog/post.html` -> `/blog/post.html`

### Windows (PowerShell)

```powershell
Set-Location C:\path\to\site-root
Get-ChildItem -Force | Compress-Archive -DestinationPath ..\site.zip -Force
```

### macOS

```bash
cd /path/to/site-root
zip -r ../site.zip .
```

### Linux

```bash
cd /path/to/site-root
zip -r ../site.zip .
```

## Local Run

Run:

```bash
./serve.sh
```

Optional port:

```bash
./serve.sh 9000
```

Important:

- Open with `http://` (not `file://`) so service workers work.
- The first load of a deep path may require one automatic reload so the service worker can take control.

## Deep-Link Routing Test

1. Start the server with `./serve.sh` and open `http://localhost:8080/`.
2. Upload a ZIP that contains at least:
   - `index.html`
   - `blog/post.html`
3. Open `http://localhost:8080/blog/post.html` directly in the address bar.
4. Hard refresh once if this is the first deep-link request (service worker takeover).
5. Confirm the uploaded `blog/post.html` content is shown.
6. Open `http://localhost:8080/SSV_config.html`, click `Clear All Uploaded Content`, and confirm `/blog/post.html` no longer resolves to uploaded content.
