
import { useState } from "react";
import type { CanvasItem, ItemSummary } from "@/lib/types";
import { PlatformIcon } from "./platform-icon";
import { TweetEmbed } from "./tweet-embed";
import { YouTubeEmbed } from "./youtube-embed";

type UrlItem = Extract<CanvasItem, { type: "url" }>;

export function UrlCard({
  item,
  summary,
  readonly,
  onMeasureTweet,
}: {
  item: UrlItem;
  summary?: ItemSummary;
  readonly?: boolean;
  onMeasureTweet?: (ratio: number) => void;
}) {
  if (item.platform === "twitter") {
    return (
      <TweetEmbed
        url={item.url}
        interactionOverlay={!readonly}
        onMeasure={onMeasureTweet}
      />
    );
  }

  if (item.platform === "youtube") {
    return <YouTubeEmbed url={item.url} />;
  }

  return <OGCard item={item} summary={summary} />;
}

function OGCard({ item, summary }: { item: UrlItem; summary?: ItemSummary }) {
  const og = item.ogData;
  const [imageFailed, setImageFailed] = useState(false);
  const hostname = (() => {
    try { return new URL(item.url).hostname.replace("www.", ""); }
    catch { return item.url; }
  })();

  const showImage = Boolean(og?.image) && !imageFailed;

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-full flex-col bg-card"
    >
      {showImage && (
        <div className="relative min-h-0 flex-1">
          <img
            src={og?.image}
            alt={og?.title ?? ""}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5 p-4">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={item.platform} className="h-4 w-4 shrink-0" />
          <span className="truncate text-[11px] text-muted-foreground/70">{hostname}</span>
        </div>
        {(og?.title || summary?.title) && (
          <p className="line-clamp-2 text-sm font-semibold leading-snug">
            {og?.title || summary?.title}
          </p>
        )}
        {summary?.summary && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{summary.summary}</p>
        )}
      </div>
    </a>
  );
}
