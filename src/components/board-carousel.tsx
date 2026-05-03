import { useRef, useState, type ReactNode } from "react";
import { useMountEffect } from "@/lib/use-mount-effect";

// Dominant-axis lock threshold (px). Below this we wait for clearer intent
// rather than committing to either horizontal page-swipe or vertical scroll.
const AXIS_LOCK_PX = 8;
// Commit swipe when drag crosses this fraction of viewport width.
const COMMIT_RATIO = 0.18;
// Elastic resistance factor applied when dragging past the first/last page.
const OVERDRAG_RESIST = 0.35;

export function BoardCarousel<T>({
  pages,
  activeIndex,
  getPageKey,
  renderPage,
  onNavigate,
}: {
  pages: T[];
  activeIndex: number;
  getPageKey?: (page: T, index: number) => string;
  renderPage: (page: T, index: number, isActive: boolean) => ReactNode;
  onNavigate?: (delta: -1 | 1) => void;
}) {
  const pageCount = pages.length;
  const safeIndex = pageCount === 0 ? 0 : Math.max(0, Math.min(activeIndex, pageCount - 1));
  const viewportRef = useRef<HTMLDivElement>(null);
  const [dragDx, setDragDx] = useState<number | null>(null);

  // Latest-state ref: touch handlers attach once on mount, route to the
  // current closure so pages.length / safeIndex changes don't require
  // resubscribing (and we stay within the useMountEffect-only rule).
  const latest = useRef({ safeIndex, pageCount, onNavigate, dragDx });
  latest.current = { safeIndex, pageCount, onNavigate, dragDx };

  useMountEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    // { x0, y0, locked: 'h' | 'v' | null } — gesture state for the active touch.
    let state: { x0: number; y0: number; locked: "h" | "v" | null } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const { onNavigate: nav, pageCount } = latest.current;
      if (!nav || pageCount < 2) return;
      const t = e.touches[0];
      state = { x0: t.clientX, y0: t.clientY, locked: null };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!state) return;
      const { safeIndex: idx, pageCount } = latest.current;
      const t = e.touches[0];
      const dx = t.clientX - state.x0;
      const dy = t.clientY - state.y0;
      if (!state.locked) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        state.locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
      if (state.locked !== "h") return;
      // Prevent page scroll while we're paging horizontally.
      e.preventDefault();
      let resisted = dx;
      const atStart = idx === 0 && dx > 0;
      const atEnd = idx === pageCount - 1 && dx < 0;
      if (atStart || atEnd) resisted = dx * OVERDRAG_RESIST;
      setDragDx(resisted);
    };

    const onTouchEnd = () => {
      const st = state;
      state = null;
      if (!st || st.locked !== "h") {
        setDragDx(null);
        return;
      }
      const { safeIndex: idx, pageCount, onNavigate: nav, dragDx: dd } = latest.current;
      const vw = el.clientWidth || window.innerWidth;
      const dx = dd ?? 0;
      const threshold = vw * COMMIT_RATIO;
      if (nav) {
        if (dx < -threshold && idx < pageCount - 1) nav(1);
        else if (dx > threshold && idx > 0) nav(-1);
      }
      setDragDx(null);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  });

  // Base percent offset is unchanged; dragDx is an additive px nudge during a
  // live swipe. Example: on page 2 of 3 with 40px right-drag → calc(-33.3% + 40px).
  const basePct = pageCount === 0 ? 0 : (safeIndex * 100) / pageCount;
  const dragging = dragDx !== null;

  return (
    <div ref={viewportRef} className="board-carousel-viewport">
      <div
        className="board-carousel-track"
        style={{
          width: `${Math.max(1, pageCount) * 100}%`,
          transform: dragging
            ? `translate3d(calc(-${basePct}% + ${dragDx}px), 0, 0)`
            : `translate3d(-${basePct}%, 0, 0)`,
          transition: dragging ? "none" : undefined,
        }}
      >
        {pages.map((page, i) => (
          <div
            key={getPageKey?.(page, i) ?? i}
            className="board-carousel-slide"
            style={{ width: `${100 / Math.max(1, pageCount)}%` }}
            aria-hidden={i !== safeIndex || undefined}
          >
            {renderPage(page, i, i === safeIndex)}
          </div>
        ))}
      </div>
    </div>
  );
}
