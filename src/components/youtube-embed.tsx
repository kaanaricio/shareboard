
import { useState } from "react";
import { Play } from "lucide-react";
import { extractYouTubeId } from "@/lib/youtube";

export function YouTubeEmbed({ url }: { url: string }) {
  const id = extractYouTubeId(url);
  const [playing, setPlaying] = useState(false);
  const [thumbnail, setThumbnail] = useState<"maxres" | "hq">("maxres");
  if (!id) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-full items-center justify-center bg-black text-sm text-white/60 underline"
      >
        View on YouTube
      </a>
    );
  }

  const thumbnailUrl =
    thumbnail === "maxres"
      ? `https://img.youtube.com/vi/${id}/maxresdefault.jpg`
      : `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

  if (!playing) {
    return (
      <div className="youtube-poster">
        <img
          src={thumbnailUrl}
          alt="YouTube video thumbnail"
          className="youtube-poster-image"
          draggable={false}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setThumbnail("hq")}
        />
        <button
          type="button"
          className="youtube-poster-play grid-no-drag"
          aria-label="Play YouTube video"
          onClick={(e) => {
            e.stopPropagation();
            setPlaying(true);
          }}
        >
          <Play className="h-6 w-6 fill-current" />
        </button>
      </div>
    );
  }

  return (
    <div className="youtube-frame-wrap grid-no-drag">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`}
        title="YouTube video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="origin"
        className="absolute inset-0 h-full w-full"
        loading="lazy"
      />
      <a
        href={`https://www.youtube.com/watch?v=${id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="youtube-open-link"
        onClick={(e) => e.stopPropagation()}
      >
        YouTube
      </a>
    </div>
  );
}
