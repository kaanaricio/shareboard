import { createFileRoute } from "@tanstack/react-router";
import { takeRateLimit } from "@/lib/rate-limit";
import { fetchPublicUrl, BROWSER_UA } from "@/lib/safe-fetch";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const HEAD_CLOSE = "</head>";

function getClientIp(request: Request): string | null {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip && ip.length > 0 ? ip : null;
}

async function readHeadHtml(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      const headEnd = buffer.toLowerCase().indexOf(HEAD_CLOSE);
      if (headEnd !== -1) {
        return buffer.slice(0, headEnd + HEAD_CLOSE.length);
      }
      if (total > MAX_HTML_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return buffer;
}

function resolveAbsolute(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const resolved = new URL(value, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function decodeEntities(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseOG(html: string, pageUrl: string) {
  const get = (property: string): string | undefined => {
    const patterns = [
      new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, "i"),
      new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${property}["']`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeEntities(match[1]);
    }
    return undefined;
  };

  const titleTag = decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);
  const rawImage = get("og:image") || get("og:image:url") || get("twitter:image");

  return {
    title: get("og:title") || get("twitter:title") || titleTag,
    description: get("og:description") || get("twitter:description") || get("description"),
    image: resolveAbsolute(rawImage, pageUrl),
    siteName: get("og:site_name"),
    author: get("article:author") || get("author"),
  };
}

export const Route = createFileRoute("/api/og")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ip = getClientIp(request);
        if (ip) {
          const rate = takeRateLimit(`og:${ip}`, 60, 5 * 60 * 1000);
          if (!rate.ok) {
            return Response.json(
              { error: "Too many metadata requests. Try again shortly." },
              { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
            );
          }
        }

        const rawUrl = new URL(request.url).searchParams.get("url");
        if (!rawUrl) {
          return Response.json({ error: "Missing url parameter" }, { status: 400 });
        }

        try {
          const { response: res, url: finalUrl } = await fetchPublicUrl(rawUrl, {
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
            },
            signal: AbortSignal.timeout(5000),
          });

          if (!res.ok) {
            return Response.json({ error: "Failed to fetch", upstream: res.status }, { status: 502 });
          }

          const contentType = res.headers.get("content-type") || "";
          if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
            return Response.json({ error: "URL is not an HTML page" }, { status: 415 });
          }

          const html = await readHeadHtml(res);
          const og = parseOG(html, finalUrl);

          return Response.json(og, {
            headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Fetch failed";
          const status = /private hosts|allowed|too large/i.test(message) ? 400 : 502;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
