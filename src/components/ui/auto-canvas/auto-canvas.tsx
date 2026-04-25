import { forwardRef, useCallback, useMemo, useRef, type ReactNode } from "react";
import { Responsive, useContainerWidth, noCompactor } from "react-grid-layout";
import type { Layout, LayoutItem, ResponsiveLayouts } from "react-grid-layout";
import { aspectRatio, gridBounds, snapToGrid } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import type { AutoLayouts, TileSpecMap } from "./types";
import { chooseRows, chooseSpan, mergeLayout } from "./pack";

// rgl reads allowOverlap off the compactor (not props). With allowOverlap the
// placeholder tracks the cursor every frame even when hovering other tiles —
// otherwise it freezes at the source x/y. We reject overlapping drops ourselves
// in handleInteractionStop.
const freePlacementCompactor = { ...noCompactor, allowOverlap: true } as typeof noCompactor & { allowOverlap: true };

// shape: { x:3, y:2, w:6, h:6 }
function rectsOverlap(a: Pick<LayoutItem, "x" | "y" | "w" | "h">, b: Pick<LayoutItem, "x" | "y" | "w" | "h">): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export interface AutoCanvasProps {
  /** Grid columns at the lg breakpoint (default 24). */
  columns?: number;
  /** Columns at the sm breakpoint (default 1). */
  smColumns?: number;
  /** lg breakpoint in px (default 768). */
  lgBreakpoint?: number;
  /** Pixel height of one grid row (default 20). */
  rowHeight?: number;
  /** Gap between tiles in px (default 12). */
  gap?: number;
  /** Row budget; if omitted, the canvas grows unbounded vertically. */
  maxRows?: number;
  /**
   * Sizing hints per tile id. Aspect-locked tiles derive height from their
   * chosen span; flex tiles use `preferredRows`.
   */
  tileSpecs: TileSpecMap;
  /** Persisted layouts by breakpoint. Missing tiles are packed in. */
  layout?: AutoLayouts;
  /** Called when the user drags/resizes, or when an aspect tile reflows. */
  onLayoutChange?: (next: AutoLayouts) => void;
  /** Disable drag/resize/compaction. */
  readonly?: boolean;
  /** Children must have `key={id}` matching a tileSpecs id. */
  children: ReactNode;
  /** Extra className on the grid container. */
  className?: string;
}

/**
 * AutoCanvas — auto-layout grid with aspect-aware sizing and skyline masonry packing.
 *
 * Drop-in replacement for react-grid-layout's Responsive when:
 *  - You want initial placement to respect per-tile aspect ratios (media embeds,
 *    images) and natural max widths (e.g. 550 for tweets).
 *  - You want new tiles to tuck into the shortest-column gap rather than
 *    starting a new row.
 *  - You want aspect-locked tiles to reflow when the container resizes (not just
 *    when the user drags a resize handle).
 *
 * Persisted `layout` takes precedence for known tile ids. New ids (first render
 * or after adding a tile) are packed in via a skyline masonry pass.
 */
export const AutoCanvas = forwardRef<HTMLDivElement, AutoCanvasProps>(function AutoCanvas(
  {
    columns = 24,
    smColumns = 1,
    lgBreakpoint = 768,
    rowHeight = 20,
    gap = 12,
    maxRows,
    tileSpecs,
    layout,
    onLayoutChange,
    readonly,
    children,
    className,
  },
  forwardedRef,
) {
  const { containerRef, width } = useContainerWidth();

  // Track the current breakpoint so interaction callbacks persist to the right layout.
  const breakpointRef = useRef<"lg" | "sm">("lg");

  // Merge persisted layout with packed positions for new tiles, at both breakpoints.
  // The dependency on `width` matters: packing math uses pixels to choose spans for
  // aspect-locked tiles, so heights stay correct across container resizes.
  const merged = useMemo<ResponsiveLayouts>(() => {
    const specs = Object.entries(tileSpecs)
      .filter(([, spec]) => spec !== undefined)
      .map(([id, spec]) => ({ id, ...spec! }));

    const cw = width > 0 ? width : Math.max(columns * 40, 800);

    const lg = mergeLayout(layout?.lg ?? [], specs, {
      columns,
      containerWidth: cw,
      rowHeight,
      gap,
      maxRows,
    });

    // Small breakpoint: one-column stack, each tile at its preferred rows.
    const smSpecs = specs;
    const sm: LayoutItem[] = [];
    let smY = 0;
    for (const spec of smSpecs) {
      const span = Math.min(smColumns, chooseSpan(spec, {
        columns: smColumns,
        containerWidth: cw,
        rowHeight,
        gap,
        maxRows,
      }));
      const rows = chooseRows(spec, span, {
        columns: smColumns,
        containerWidth: cw,
        rowHeight,
        gap,
        maxRows,
      });
      sm.push({
        i: spec.id,
        x: 0,
        y: smY,
        w: span,
        h: rows,
        minW: 1,
        minH: spec.minRows ?? 3,
      });
      smY += rows;
    }

    // Apply per-tile constraints:
    //   - snapToGrid(1) keeps the placeholder's grid coordinates as clean
    //     integers (the card itself still tracks the cursor pixel-for-pixel —
    //     that's a react-grid-layout internal we can't intercept without
    //     forking).
    //   - Aspect-locked tiles keep their pxW/pxH ratio during resize.
    //   - gridBounds prevents horizontal overflow.
    //
    // Note we intentionally do NOT cap maxH by (maxRows - y). Capping it
    // means resize gets reverted as soon as it would push another tile
    // off-screen — the "fridge" problem (user expects sibling tiles to
    // rearrange to make room). With no cap, resize flows freely; the canvas
    // scrolls vertically if content exceeds the viewport. maxRows is still
    // honoured by the packer as a *soft* target for initial placement.
    // Re-derive height for aspect-locked tiles each render so width changes
    // (new cached aspect, container resize) reflow heights without persisting.
    // Flex tiles keep their persisted/packed h.
    const applyAspectAndConstraints = (items: LayoutItem[], cols: number) =>
      items.map((l) => {
        const spec = tileSpecs[l.i];
        if (!spec) return { ...l, constraints: [snapToGrid(1), gridBounds] };
        if (spec.aspect && spec.aspect > 0) {
          const rows = chooseRows(spec, l.w, {
            columns: cols,
            containerWidth: cw,
            rowHeight,
            gap,
            maxRows,
          });
          return {
            ...l,
            h: rows,
            constraints: [snapToGrid(1), aspectRatio(spec.aspect), gridBounds],
          };
        }
        return { ...l, constraints: [snapToGrid(1), gridBounds] };
      });

    return {
      lg: applyAspectAndConstraints(lg, columns),
      sm: applyAspectAndConstraints(sm, smColumns),
    };
  }, [tileSpecs, layout, width, columns, smColumns, rowHeight, gap, maxRows]);

  // Snapshot of the pre-drag layout so we can revert an overlapping drop.
  // Example: [{ i:"a", x:0, y:0, w:6, h:6 }, { i:"b", x:6, y:0, w:6, h:6 }]
  const preInteractionRef = useRef<Layout | null>(null);

  const handleInteractionStart = useCallback(
    (current: Layout, kind: "drag" | "resize") => {
      preInteractionRef.current = current.map((l) => ({ ...l }));
      document.body.classList.add("grid-interacting");
      // Resize-specific class so the placeholder can render as the *primary*
      // snap-target signal (above the live tile, stronger contrast). During
      // drag we keep the quieter ghost — the user's eye follows the card.
      if (kind === "resize") document.body.classList.add("grid-resizing");
    },
    [],
  );

  const handleInteractionStop = useCallback(
    (next: Layout) => {
      document.body.classList.remove("grid-interacting");
      document.body.classList.remove("grid-resizing");
      if (!onLayoutChange || readonly) return;

      const before = preInteractionRef.current ?? [];
      preInteractionRef.current = null;

      // Find which item changed (dragged or resized). We only need to reject
      // that one — siblings can never collide with each other because the
      // compactor never shifts them.
      const moved = next.find((l) => {
        const p = before.find((pp) => pp.i === l.i);
        return p && (p.x !== l.x || p.y !== l.y || p.w !== l.w || p.h !== l.h);
      });

      let finalLayout = next;
      if (moved) {
        const others = next.filter((l) => l.i !== moved.i);
        const collides = others.some((o) => rectsOverlap(moved, o));
        if (collides) {
          const prev = before.find((p) => p.i === moved.i);
          if (prev) {
            finalLayout = next.map((l) =>
              l.i === moved.i ? { ...l, x: prev.x, y: prev.y, w: prev.w, h: prev.h } : l,
            );
          }
        }
      }

      const bp = breakpointRef.current;
      const prevLayouts: AutoLayouts = {
        lg: layout?.lg ?? [],
        sm: layout?.sm ?? [],
      };
      onLayoutChange({ ...prevLayouts, [bp]: [...finalLayout] });
    },
    [onLayoutChange, readonly, layout],
  );

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      (containerRef as { current: HTMLDivElement | null }).current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) (forwardedRef as { current: HTMLDivElement | null }).current = node;
    },
    [containerRef, forwardedRef],
  );

  return (
    <div
      ref={setContainerRef}
      className={className}
      style={{ width: "100%", minHeight: "100%" }}
    >
      {width > 0 && (
        <Responsive
          width={width}
          layouts={merged}
          breakpoints={{ lg: lgBreakpoint, sm: 0 }}
          cols={{ lg: columns, sm: smColumns }}
          rowHeight={rowHeight}
          margin={[gap, gap]}
          containerPadding={[0, 0]}
          autoSize={true}
          dragConfig={{
            enabled: !readonly,
            cancel: ".ProseMirror, input, textarea, [contenteditable=true], .grid-card-close, .grid-no-drag",
          }}
          resizeConfig={{ enabled: !readonly, handles: ["se", "sw", "ne", "nw"] }}
          compactor={freePlacementCompactor}
          onBreakpointChange={(bp: string) => {
            breakpointRef.current = bp === "sm" ? "sm" : "lg";
          }}
          onDragStart={(l: Layout) => handleInteractionStart(l, "drag")}
          onDragStop={(l: Layout) => handleInteractionStop(l)}
          onResizeStart={(l: Layout) => handleInteractionStart(l, "resize")}
          onResizeStop={(l: Layout) => handleInteractionStop(l)}
        >
          {children}
        </Responsive>
      )}
    </div>
  );
});
