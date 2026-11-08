# Deploy

The app is static files with ES modules. No build step. Relative paths only, so it works at a domain root or in a subdirectory.

## Local

```bash
node server.mjs            # http://localhost:8080
PORT=3000 node server.mjs
```

Why a server instead of opening `index.html`? ES modules and IndexedDB are restricted on `file://`. Any static server works (`python3 -m http.server` is fine too).

## Vercel

```bash
vercel
```

- `vercel.json` adds security headers and caching.
- `api/relay.js` is detected automatically as `/api/relay`.
- Environment variables (optional): `RELAY_TOKEN`, `ALLOWED_HOSTS`.
- No build command, no output directory — framework preset “Other”.

## Netlify

```bash
netlify deploy --prod
```

`netlify.toml` publishes the repository root, adds headers and an SPA redirect. The relay is **not** available on Netlify as written (it is a Vercel/Node function); either skip the relay (most providers work without it) or port `api/relay.js` to a Netlify Function.

## Cloudflare Pages

- Build command: none. Output directory: `/`.
- Pages Functions can host the relay at `functions/api/relay.js` by adapting `api/relay.js` (same logic, `Request`/`Response` API).
- Set `RELAY_TOKEN` as an encrypted environment variable.

## GitHub Pages

Push the folder to a repository and enable Pages. Because all paths are relative, a project subpath (`/repo-name/`) works. The relay is unavailable unless hosted elsewhere.

## nginx

```nginx
server {
  listen 443 ssl;
  server_name studio.example.com;
  root /var/www/ztc-studio;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(css|js|mjs)$ {
    add_header Cache-Control "public, max-age=300";
    types { }
    default_type application/javascript;
  }

  add_header X-Content-Type-Options nosniff;
  add_header Referrer-Policy no-referrer;
}
```

## Relay security

The relay is a forwarder, not an open proxy:

- Requires `RELAY_TOKEN`; requests without the matching `X-Relay-Token` get 401.
- Only `https:` targets on an allow-list (provider hosts + `ALLOWED_HOSTS`).
- Strips `Origin`, `Referer`, `Host`, `Cookie`, `Content-Length`.
- 120-second upstream timeout; no response caching.
- Never adds credentials. Provider keys travel in the request as they would directly.

Rotate the token if it leaks. If you do not need it, leave `RELAY_TOKEN` unset — the relay returns 503 and the app talks to providers directly.

## HTTPS

Required for clipboard, service workers and any future microphone feature. Vercel/Netlify/Pages provide it. Local `http://localhost` is treated as a secure context by browsers.

## Content Security Policy

`index.html` ships a strict CSP:

```
default-src 'self'; script-src 'self' https://js.puter.com;
img-src 'self' data: blob: https:; media-src 'self' blob: data:;
connect-src 'self' https: blob:; style-src 'self' 'unsafe-inline'
```

- `https://js.puter.com` is required for Puter voice/chat. If you remove that line, Puter fails and the app falls back to StreamElements or your endpoint.
- `connect-src https:` is broad because the provider list is user-configurable. Tighten it to your actual providers if you self-host for a fixed audience.
- Generated media uses `blob:` URLs, which the policy allows.

## Caching

- HTML: `no-store` (so updates land immediately).
- JS/CSS: short cache; ES modules are not fingerprinted. Bump the version query or the filename if you deploy behind a long-lived CDN.
- No service worker, so no stale-asset trap.

## Data residency

All project data, media and keys stay in the browser. The only outbound traffic is to the AI providers you invoke. There is no telemetry and no analytics script.
