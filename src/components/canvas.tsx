
import { useMemo, useCallback, useState, useRef } from "react";
import { X } from "lucide-react";
import type { CanvasItem, GenerateResponse, GridLayouts } from "@/lib/types";
import { UrlCard } from "./url-card";
import { ImageCard } from "./image-card";
import { ImageLightbox } from "./image-lightbox";
import { NoteCard } from "./note-card";
import { SummarySection } from "./summary-section";
import {
  AutoCanvas,
  useAspectCache,
  type AutoLayouts,
} from "@/components/ui/auto-canvas";
import {
  LG_COLS,
  ROW_HEIGHT,
  MARGIN,
  LG_BREAKPOINT,
  buildTileSpecs,
} from "@/lib/tile-specs";
import { extractTweetId } from "@/lib/youtube";

/** localStorage key for the tweet aspect-ratio cache. Exported for tests only. */
export const TWEET_ASPECT_STORAGE_KEY = "shareboard_tweet_aspects";

function isTwitterItem(item: CanvasItem): boolean {
  return item.type === "url" && item.platform === "twitter";
}

export function Canvas({
  items,
  generation,
  layouts,
  selectedIds,
  onSelect,
  onLayoutChange,
  onRemove,
  onDropData,
  onUpdateNoteText,
  maxRows: maxRowsProp,
  onMaxRowsChange,
  readonly,
  /** When false, drag/drop on the canvas is disabled (e.g. first-run setup dialog). */
  acceptExternalDrop,
  emptyStateHint,
  hideEmptyState,
}: {
  items: CanvasItem[];
  generation?: GenerateResponse | null;
  layouts: GridLayouts;
  /** Row budget for the lg breakpoint — must match layout generation in tile-specs. */
  maxRows: number;
  selectedIds?: string[];
  onSelect?: (id: string | null, e?: React.MouseEvent) => void;
  onLayoutChange?: (layouts: GridLayouts) => void;
  onRemove?: (id: string) => void;
  onDropData?: (data: DataTransfer) => void;
  onUpdateNoteText?: (id: string, text: string) => void;
  onMaxRowsChange?: (rows: number) => void;
  readonly?: boolean;
  acceptExternalDrop?: boolean;
  emptyStateHint?: string;
  hideEmptyState?: boolean;
}) {
  const acceptDrop = acceptExternalDrop !== false;
  const [isDragOver, setIsDragOver] = useState(false);
  // Readonly-only: tapping an image opens a fullscreen lightbox. In the editor
  // a tap means "select", so we never open the lightbox there.
  const [lightbox, setLightbox] = useState<{ src: string; alt?: string } | null>(null);
  const dragCountRef = useRef(0);

  // Persisted aspect cache — tweets that have been seen in any board on this
  // device place correctly on first paint on the next visit.
  const aspectCache = useAspectCache({ storageKey: TWEET_ASPECT_STORAGE_KEY });

  // Stash the latest onMaxRowsChange so the observer always calls the current
  // callback without resubscribing.
  const onMaxRowsChangeRef = useRef(onMaxRowsChange);
  onMaxRowsChangeRef.current = onMaxRowsChange;

  // Callback ref: wire up a ResizeObserver when the outer container mounts,
  // tear it down when it unmounts. AutoCanvas measures its own inner width
  // separately via useContainerWidth.
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const calc = () => {
      const rect = el.getBoundingClientRect();
      // Read computed padding so maxRows tracks the canvas's asymmetric padding
      // (bottom is larger to reserve space for the fixed toolbar).
      const cs = getComputedStyle(el);
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBottom = parseFloat(cs.paddingBottom) || 0;
      const innerH = rect.height - padTop - padBottom;
      const rows = Math.max(4, Math.floor((innerH + MARGIN) / (ROW_HEIGHT + MARGIN)));
      onMaxRowsChangeRef.current?.(rows);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    // React 19 calls the ref cleanup on unmount.
    return () => ro.disconnect();
  }, []);

  // Build tile specs with live aspect-cache data folded in.
  const tileSpecs = useMemo(
    () => buildTileSpecs(items, aspectCache.snapshot),
    [items, aspectCache.snapshot],
  );

  // Persist a measured tweet ratio under a stable key (tweet id) so the cache
  // survives reloads and cross-board visits.
  const handleMeasureTweet = useCallback(
    (item: CanvasItem, ratio: number) => {
      if (item.type !== "url" || item.platform !== "twitter") return;
      const tweetId = extractTweetId(item.url);
      if (!tweetId) return;
      aspectCache.set(`tweet:${tweetId}`, ratio);
    },
    [aspectCache],
  );

  const handleMeasureImage = useCallback(
    (item: CanvasItem, ratio: number) => {
      if (item.type !== "image") return;
      const key = "url" in item ? `image:${item.url}` : `image:${item.id}`;
      aspectCache.set(key, ratio, { persist: "url" in item });
    },
    [aspectCache],
  );

  const handleAutoLayoutChange = useCallback(
    (next: AutoLayouts) => {
      if (!onLayoutChange || readonly) return;
      onLayoutChange(next);
    },
    [onLayoutChange, readonly],
  );

  const getSummary = (id: string) =>
    generation?.item_summaries.find((s) => s.item_id === id);

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const isBackground =
        e.target === e.currentTarget ||
        target.classList.contains("react-grid-layout");
      if (isBackground && onSelect) onSelect(null);
    },
    [onSelect]
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!acceptDrop) return;
      e.preventDefault();
      dragCountRef.current++;
      if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
    },
    [acceptDrop],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!acceptDrop) return;
      e.preventDefault();
      dragCountRef.current--;
      if (dragCountRef.current <= 0) {
        dragCountRef.current = 0;
        setIsDragOver(false);
      }
    },
    [acceptDrop],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!acceptDrop) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [acceptDrop],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!acceptDrop) return;
      e.preventDefault();
      dragCountRef.current = 0;
      setIsDragOver(false);
      if (onDropData) onDropData(e.dataTransfer);
    },
    [acceptDrop, onDropData],
  );

  const isEmpty = items.length === 0;

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full min-h-0 min-w-0 p-3 pb-20 md:p-5 md:pb-24 overflow-hidden relative"
      onClick={handleBackgroundClick}
      onDragEnter={acceptDrop ? handleDragEnter : undefined}
      onDragLeave={acceptDrop ? handleDragLeave : undefined}
      onDragOver={acceptDrop ? handleDragOver : undefined}
      onDrop={acceptDrop ? handleDrop : undefined}
    >
      {isDragOver && (
        <div className="absolute inset-3 md:inset-5 z-50 flex items-center justify-center bg-black/5 backdrop-blur-sm rounded-3xl pointer-events-none">
          <p className="text-lg font-medium text-foreground/60">Drop to add</p>
        </div>
      )}
      {isEmpty
        ? !hideEmptyState && (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-center select-none max-w-md">
                {emptyStateHint ? (
                  <>
                    <p className="text-2xl md:text-3xl font-semibold tracking-tight text-inset">
                      {emptyStateHint}
                    </p>
                    <p className="text-base md:text-lg mt-2.5 text-inset max-w-[28ch] mx-auto leading-relaxed">
                      Then paste links, images, or notes here
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl md:text-3xl font-semibold tracking-tight text-inset">
                      Paste anything to get started
                    </p>
                    <p className="text-base md:text-lg mt-2.5 text-inset max-w-[28ch] mx-auto leading-relaxed">
                      Links, images, or text — Cmd+V
                    </p>
                  </>
                )}
              </div>
            </div>
          )
        : (
          <AutoCanvas
            columns={LG_COLS}
            rowHeight={ROW_HEIGHT}
            gap={MARGIN}
            maxRows={maxRowsProp}
            lgBreakpoint={LG_BREAKPOINT}
            tileSpecs={tileSpecs}
            layout={layouts}
            onLayoutChange={handleAutoLayoutChange}
            readonly={readonly}
          >
            {items.map((item) => (
              <div
                key={item.id}
                className={`group overflow-hidden rounded-lg ${selectedIds?.includes(item.id) ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : ""} ${readonly && item.type === "image" ? "cursor-zoom-in" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (readonly && item.type === "image") {
                    const src = "url" in item ? item.url : item.previewUrl;
                    if (src) setLightbox({ src, alt: item.caption });
                    return;
                  }
                  const target = e.target as HTMLElement | null;
                  if (
                    target?.closest(".ProseMirror, input, textarea, [contenteditable=true], .grid-no-drag")
                  ) {
                    return;
                  }
                  onSelect?.(item.id, e);
                }}
              >
                {!readonly && onRemove && (
                  <div className="grid-card-close absolute top-2.5 right-2.5 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 grid-interacting-fade">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(item.id);
                      }}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:scale-110"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  </div>
                )}
                {item.type === "url" && !readonly && !isTwitterItem(item) && item.platform !== "youtube" && (
                  <div className="absolute inset-0 z-10 rounded-3xl" />
                )}
                <div
                  className={`h-full w-full ${
                    item.type === "url" ? "overflow-hidden" : "overflow-auto"
                  }`}
                >
                  {item.type === "url" && (
                    <UrlCard
                      item={item}
                      summary={getSummary(item.id)}
                      readonly={readonly}
                      onMeasureTweet={
                        isTwitterItem(item)
                          ? (ratio) => handleMeasureTweet(item, ratio)
                          : undefined
                      }
                    />
                  )}
                  {item.type === "image" && (
                    <ImageCard
                      item={item}
                      summary={getSummary(item.id)}
                      onMeasure={(ratio) => handleMeasureImage(item, ratio)}
                    />
                  )}
                  {item.type === "note" && (
                    <NoteCard
                      item={item}
                      summary={getSummary(item.id)}
                      readonly={readonly}
                      onUpdateText={onUpdateNoteText}
                    />
                  )}
                  {item.type === "board_summary" && generation && (
                    <div className="h-full w-full border border-border/40 bg-card rounded-3xl p-5">
                      <SummarySection summary={generation.overall_summary} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </AutoCanvas>
        )}
      <ImageLightbox
        src={lightbox?.src ?? null}
        alt={lightbox?.alt}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}
