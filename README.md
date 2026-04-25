# Shareboard

A canvas for collecting URLs, notes, embeds, pasted SVG, and images, with optional AI summaries. Free side project — **not** a paid product. You bring your own [OpenAI](https://platform.openai.com/) key; it stays in the browser and is sent to the API only for generation.

## Run locally

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000), set a display name, optionally add an API key, then use the app.

`npm start` also runs the dev server with hot reload. Use `bun run build && bun run preview` only when you want to serve the latest production build output.

## Configuration

Media-backed shared boards use Cloudflare R2. Tiny text/URL-only boards can share as compressed URL fragments and do not require storage. Without R2 env vars, the editor and tiny shares still work.

Copy `.env.example` → `.env` and fill in values:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `R2_PUBLIC_URL`

On Cloudflare Workers, the app prefers the `SHAREBOARD_R2` bucket binding in `wrangler.jsonc`; the account ID/API token path is only a fallback for local or legacy deployments. `R2_PUBLIC_URL` is required as a Worker secret so shared image URLs can point directly at R2 instead of proxying through the app.

Do not commit account-specific URLs, tokens, bucket endpoints, API keys, or internal planning docs. This repository is intended to be public and self-hostable.

## Deploy on Cloudflare

Create the bucket once:

```bash
bunx wrangler r2 bucket create shareboard
```

Enable public access for the bucket and copy the resulting `r2.dev` URL:

```bash
bunx wrangler r2 bucket dev-url enable shareboard
bunx wrangler r2 bucket dev-url get shareboard
```

Set that URL as a Worker secret, then deploy:

```bash
bunx wrangler secret put R2_PUBLIC_URL
bun run deploy:cloudflare
```

For cost control, configure lifecycle expiry on the anonymous share prefixes:

```bash
bunx wrangler r2 bucket lifecycle add shareboard expire-canvases-30d canvases/ --expire-days 30 --force
bunx wrangler r2 bucket lifecycle add shareboard expire-images-30d images/ --expire-days 30 --force
```

Use a shorter expiry for public demos. Stored board manifests are cacheable for one hour; delete links still remove the source objects, but recently viewed public copies may linger until cache expiry.

The committed `wrangler.jsonc` deliberately contains only reusable infrastructure shape: Worker name, static assets, and the `SHAREBOARD_R2` binding. Each operator supplies their own bucket endpoint through Cloudflare secrets.

### Custom Domain

The default `workers.dev` URL is fine for development and demos. For a polished public launch, attach a Cloudflare custom domain after the domain is on Cloudflare:

```jsonc
{
  "routes": [
    { "pattern": "clip.example.com", "custom_domain": true }
  ]
}
```

Cloudflare creates DNS records and certificates for Worker custom domains. Keep domain-specific routes out of forks unless they belong to that deployment.

## Share Architecture

- Tiny text/URL-only boards are encoded into `/s#b=...` links using browser compression. The server stores nothing for those links.
- Media-backed boards are stored in Cloudflare R2 as one cacheable JSON manifest at `canvases/{id}.json`.
- Shared images are optimized in the browser, uploaded as separate R2 objects under `images/{id}/{itemId}`, and referenced by URL from the manifest.
- The editor never persists local blob URLs or `File` objects.
- Non-image files are intentionally rejected. This is a shareboard, not general file storage.
- Stored R2 shares return a one-time delete token, stored locally in the browser for future deletion flows.

## Stack

TanStack Start + Vite, React 19, Tailwind v4, Cloudflare R2 — see `package.json`.
