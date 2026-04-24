import { createFileRoute } from "@tanstack/react-router";
import { takeRateLimit } from "@/lib/rate-limit";
import { fetchPublicUrl, BROWSER_UA } from "@/lib/safe-fetch";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FALLBACK_CACHE = "public, max-age=86400, stale-while-revalidate=604800";
const EMPTY_IMAGE_HEADERS = {
  "Cache-Control": "public, max-age=3600",
};

function getClientIp(request: Request): string | null {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip && ip.length > 0 ? ip : null;
}

export const Route = createFileRoute("/api/og/image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ip = getClientIp(request);
        if (ip) {
          const rate = takeRateLimit(`og-image:${ip}`, 60, 5 * 60 * 1000);
          if (!rate.ok) {
            return Response.json(
              { error: "Too many image proxy requests. Try again shortly." },
              { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
            );
          }
        }

        const rawUrl = new URL(request.url).searchParams.get("url");
        if (!rawUrl) {
          return Response.json({ error: "Missing url parameter" }, { status: 400 });
        }

        let upstream: Response;
        try {
          ({ response: upstream } = await fetchPublicUrl(rawUrl, {
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
            signal: AbortSignal.timeout(8000),
          }));
        } catch {
          return new Response(null, { status: 204, headers: EMPTY_IMAGE_HEADERS });
        }

        if (!upstream.ok || !upstream.body) {
          return new Response(null, { status: 204, headers: EMPTY_IMAGE_HEADERS });
        }

        const contentType = upstream.headers.get("content-type") || "";
        if (!contentType.toLowerCase().startsWith("image/")) {
          return new Response(null, { status: 204, headers: EMPTY_IMAGE_HEADERS });
        }

        const declaredLength = Number(upstream.headers.get("content-length") || "0");
        if (declaredLength && declaredLength > MAX_IMAGE_BYTES) {
          return new Response(null, { status: 204, headers: EMPTY_IMAGE_HEADERS });
        }

        const limited = new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = upstream.body!.getReader();
            let total = 0;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > MAX_IMAGE_BYTES) {
                  controller.error(new Error("Image too large"));
                  await reader.cancel().catch(() => {});
                  return;
                }
                controller.enqueue(value);
              }
              controller.close();
            } catch (err) {
              controller.error(err);
            }
          },
        });

        const headers = new Headers();
        headers.set("Content-Type", contentType);
        headers.set(
          "Cache-Control",
          upstream.headers.get("cache-control") || FALLBACK_CACHE
        );
        const etag = upstream.headers.get("etag");
        if (etag) headers.set("ETag", etag);

        return new Response(limited, { headers });
      },
    },
  },
});
