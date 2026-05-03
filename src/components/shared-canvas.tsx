import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMountEffect } from "@/lib/use-mount-effect";
import type { Canvas as CanvasType } from "@/lib/types";
import { Canvas } from "@/components/canvas";
import { BoardCarousel } from "@/components/board-carousel";
import { PageNav } from "@/components/page-nav";
import { estimateMaxRowsFromViewport } from "@/lib/tile-specs";
import { notify } from "@/lib/toast";
import { hydrateSharedBoardPages } from "@/lib/shared-board";
import { useSharedPageNavigation } from "@/lib/use-shared-page-navigation";
import { X as XIcon } from "@/components/ui/svgs/x";
import { InstagramIcon } from "@/components/ui/svgs/instagramIcon";
import { Linkedin } from "@/components/ui/svgs/linkedin";
import { ArrowRight, Share2 } from "lucide-react";

export function SharedCanvas({
  canvas,
  initialPageIndex = 0,
}: {
  canvas: CanvasType;
  initialPageIndex?: number;
}) {
  const [maxRows, setMaxRows] = useState(estimateMaxRowsFromViewport);

  const pages = useMemo(() => hydrateSharedBoardPages(canvas), [canvas]);
  const { activePage, setActivePage } = useSharedPageNavigation({
    initialPageIndex,
    pageCount: pages.length,
  });

  // Latest-handler ref: install the keydown listener once on mount, route to
  // the current closure so activePage/pages.length changes don't resubscribe.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
      return;
    }
    if (e.key === "ArrowLeft" && activePage > 0) {
      e.preventDefault();
      setActivePage(activePage - 1);
    }
    if (e.key === "ArrowRight" && activePage < pages.length - 1) {
      e.preventDefault();
      setActivePage(activePage + 1);
    }
  };
  useMountEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const p = canvas.authorProfile;

  // navigator.share is mobile-native (iOS/Android system sheet); on desktop
  // Chrome/Edge it exists too but UX is meh — clipboard fallback is fine for
  // anything that throws (user-cancel "AbortError" is also swallowed silently).
  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    const title = `${canvas.author} — Shareboard`;
    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    if (canNativeShare) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      notify.success("Link copied");
    } catch {
      notify.error("Couldn't share link");
    }
  };

  const hasSocials = !!(p && (p.xUrl || p.instagramUrl || p.linkedinUrl));

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="board-notch" aria-label="Board info">
        <span className="board-notch-meta">
          <span className="board-notch-meta-name">{canvas.author}</span>
        </span>
        {hasSocials && (
          <>
            <span className="board-notch-divider" aria-hidden />
            <span className="board-notch-socials">
              {p?.xUrl && (
                <a
                  href={p.xUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="board-notch-social"
                  aria-label="X profile"
                >
                  <XIcon className="w-3 h-3 [&_path]:fill-current" />
                </a>
              )}
              {p?.instagramUrl && (
                <a
                  href={p.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="board-notch-social"
                  aria-label="Instagram profile"
                >
                  <InstagramIcon className="w-3 h-3" />
                </a>
              )}
              {p?.linkedinUrl && (
                <a
                  href={p.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="board-notch-social"
                  aria-label="LinkedIn profile"
                >
                  <Linkedin className="w-3 h-3" />
                </a>
              )}
            </span>
          </>
        )}
        <span className="board-notch-divider" aria-hidden />
        <button
          type="button"
          className="board-notch-action"
          onClick={share}
          aria-label="Share this board"
          title="Share this board"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>Share</span>
        </button>
      </div>

      <BoardCarousel
        pages={pages}
        activeIndex={activePage}
        getPageKey={(page) => page.id}
        onNavigate={(delta) => setActivePage(activePage + delta)}
        renderPage={(page, _i, isActive) => (
          <Canvas
            items={page.items}
            generation={canvas.generation}
            layouts={page.layouts}
            maxRows={maxRows}
            onMaxRowsChange={isActive ? setMaxRows : undefined}
            readonly
          />
        )}
      />

      <div className="board-toolbar" aria-label="Board navigation">
        <span className="board-toolbar-left" />
        <span className="board-toolbar-center">
          {pages.length > 1 && (
            <PageNav
              pageCount={pages.length}
              activeIndex={activePage}
              onChange={setActivePage}
            />
          )}
        </span>
        <span className="board-toolbar-right">
          <Link to="/" className="board-cta-link">
            <span>Make your own</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </span>
      </div>
    </div>
  );
}
