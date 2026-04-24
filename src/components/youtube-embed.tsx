
import { extractYouTubeId } from "@/lib/youtube";

export function YouTubeEmbed({ url }: { url: string }) {
  const id = extractYouTubeId(url);
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

  return (
    <div className="relative h-full w-full bg-black">
      <iframe
        src={`https://www.youtube.com/embed/${id}`}
        title="YouTube video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="origin"
        className="absolute inset-0 h-full w-full"
        loading="lazy"
      />
    </div>
  );
}
