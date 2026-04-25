import type { LayoutItem } from "react-grid-layout";
import type { TileSpec } from "./types";

export interface PackOptions {
  /** Grid column count (e.g. 24). */
  columns: number;
  /** Container inner width in pixels. */
  containerWidth: number;
  /** Row height in pixels (react-grid-layout rowHeight). */
  rowHeight: number;
  /** Gap between cells in pixels (react-grid-layout margin, same on both axes). */
  gap: number;
  /** Row budget; if omitted, packer lays out unbounded vertically. */
  maxRows?: number;
}

/**
 * Pixel width for a `span` at the given container width.
 * Mirrors react-grid-layout's column math: N columns and N-1 gaps fill the container.
 */
export function colSpanToPx(span: number, options: PackOptions): number {
  const { columns, containerWidth, gap } = options;
  const colWidth = (containerWidth - gap * (columns - 1)) / columns;
  return colWidth * span + gap * Math.max(0, span - 1);
}

/** Inverse of colSpanToPx — pixel width → closest column span. */
export function pxToColSpan(px: number, options: PackOptions): number {
  const { columns, containerWidth, gap } = options;
  const colWidth = (containerWidth - gap * (columns - 1)) / columns;
  // px = colWidth * span + gap * (span - 1) = span*(colWidth + gap) - gap
  // span = (px + gap) / (colWidth + gap)
  return (px + gap) / (colWidth + gap);
}

/**
 * Convert pixel height to grid rows (matching react-grid-layout's height math:
 * h rows = rowHeight*h + gap*(h-1)).
 */
export function pxToRows(px: number, options: PackOptions): number {
  const { rowHeight, gap } = options;
  return (px + gap) / (rowHeight + gap);
}

/** Inverse of pxToRows. */
export function rowsToPx(rows: number, options: PackOptions): number {
  const { rowHeight, gap } = options;
  return rows * rowHeight + gap * Math.max(0, rows - 1);
}

/**
 * Choose the column span for a spec. Spans are rounded down so N tiles tile the
 * row evenly — otherwise preferredSpan=10 on a 24-col grid gives 2 tiles per row
 * with 4 empty cols on the right. With this rule, preferredSpan=10 → tiles
 * land at span=8 (3 per row, no gap). Aspect-locked tiles with `maxWidthPx`
 * use the same rule with the pixel cap as the upper bound.
 */
export function chooseSpan(spec: TileSpec, options: PackOptions): number {
  const { columns } = options;
  const min = Math.max(1, spec.minSpan ?? 3);

  // Largest span that (a) the caller wants and (b) respects maxWidthPx.
  // e.g. preferredSpan=8 → cap=8; tweet maxWidthPx=550 on a 1300px grid → cap=10.
  let cap: number;
  if (spec.maxWidthPx != null && spec.maxWidthPx > 0) {
    cap = min;
    for (let s = columns; s >= min; s--) {
      if (colSpanToPx(s, options) <= spec.maxWidthPx) { cap = s; break; }
    }
  } else {
    cap = clamp(spec.preferredSpan ?? Math.min(columns, 8), min, columns);
  }

  // Round down to a row-tiling span: tilesPerRow = ceil(columns / cap);
  // span = floor(columns / tilesPerRow). Never exceeds cap, never leaves gaps.
  // e.g. cap=10, cols=24 → tilesPerRow=3 → span=8.
  const tilesPerRow = Math.max(1, Math.ceil(columns / cap));
  return Math.max(min, Math.floor(columns / tilesPerRow));
}

/**
 * Derive grid-row height for a spec given its chosen span. Aspect-locked tiles
 * derive height from span; flex tiles use preferredRows.
 */
export function chooseRows(spec: TileSpec, span: number, options: PackOptions): number {
  const minRows = Math.max(1, spec.minRows ?? 3);
  if (spec.aspect && spec.aspect > 0) {
    const pxW = colSpanToPx(span, options);
    const pxH = pxW / spec.aspect;
    const rows = Math.max(minRows, Math.round(pxToRows(pxH, options)));
    return rows;
  }
  return Math.max(minRows, spec.preferredRows ?? 10);
}

export interface SkylineInput {
  id: string;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
}

/**
 * Skyline (Pinterest-style) masonry packer. Each tile drops into the column
 * position that minimizes y, breaking ties left-to-right. Produces denser
 * packing than row-major without row stripes.
 *
 * Tile order is preserved (no sort) so the result matches insertion order —
 * important for user predictability when adding cards.
 */
export function packSkyline(
  inputs: SkylineInput[],
  options: PackOptions,
): LayoutItem[] {
  const { columns } = options;
  const skyline: number[] = new Array(columns).fill(0);
  const out: LayoutItem[] = [];

  for (const item of inputs) {
    const w = Math.max(1, Math.min(columns, item.w));
    let bestX = 0;
    let bestY = Number.POSITIVE_INFINITY;

    for (let x = 0; x <= columns - w; x++) {
      let y = 0;
      for (let k = 0; k < w; k++) y = Math.max(y, skyline[x + k]);
      if (y < bestY) {
        bestY = y;
        bestX = x;
      }
    }
    if (!Number.isFinite(bestY)) bestY = 0;

    const y = bestY;
    const h = Math.max(1, item.h);
    for (let k = 0; k < w; k++) skyline[bestX + k] = y + h;

    // Clamp minH to the tile's actual h. If emergency scale-down has shrunk
    // this tile below its spec's minRows, we don't want react-grid-layout to
    // snap it up to minH on the first nudge of the resize handle — that
    // feels like the card "jumps" into a larger size before the user has
    // actually resized it. Users can still grow the tile by dragging outward;
    // this just removes the involuntary upward jump at resize-start.
    const effectiveMinH = item.minH != null ? Math.min(item.minH, h) : undefined;
    const effectiveMinW = item.minW != null ? Math.min(item.minW, w) : undefined;

    out.push({
      i: item.id,
      x: bestX,
      y,
      w,
      h,
      ...(effectiveMinW != null && { minW: effectiveMinW }),
      ...(effectiveMinH != null && { minH: effectiveMinH }),
      ...(item.maxW != null && { maxW: item.maxW }),
    });
  }

  return out;
}

/**
 * Generate a full layout from tile specs. Each spec picks its own span/rows
 * based on aspect/maxWidthPx/preferences, then a skyline packer places them
 * in insertion order.
 *
 * If `maxRows` is given and the packed layout would overflow, row heights are
 * scaled down uniformly until the layout fits (with minH floors respected).
 */
export function packLayout(
  specs: Array<{ id: string } & TileSpec>,
  options: PackOptions,
): LayoutItem[] {
  const inputs = specs.map((spec) => {
    const w = chooseSpan(spec, options);
    const h = chooseRows(spec, w, options);
    return {
      id: spec.id,
      w,
      h,
      minW: spec.minSpan ?? 3,
      minH: spec.minRows ?? 3,
    };
  });

  const packed = packSkyline(inputs, options);
  if (!options.maxRows || options.maxRows <= 0) return packed;

  const fits = (result: LayoutItem[]) =>
    result.every((l) => l.y + l.h <= options.maxRows!);
  if (fits(packed)) return packed;

  // Scale flex heights only. Aspect-locked tiles re-derive h from w at render,
  // so shrinking their stored h would make the packed layout lie about fit.
  const bottom = packed.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  const scale = options.maxRows / bottom;
  const shrunk = inputs.map((inp, i) => {
    const spec = specs[i];
    if (spec.aspect && spec.aspect > 0) return inp;
    return {
      ...inp,
      h: Math.max(spec.minRows ?? 3, Math.floor(inp.h * scale)),
    };
  });
  const shrunkPacked = packSkyline(shrunk, options);
  if (fits(shrunkPacked)) return shrunkPacked;

  // Budget is genuinely too tight to fit everything even at minRows. Rather
  // than crushing tiles below minRows (unreadable), keep them at minRows and
  // let the canvas scroll. This matches the "infinitely scalable canvas"
  // model: tiles stay legible; the user scrolls to reach overflow content.
  return shrunkPacked;
}

/**
 * Merge a persisted layout with fresh packing: known tile ids keep their
 * positions; new ids get packed into the empty space. If the persisted layout
 * is empty, this is equivalent to packLayout.
 */
export function mergeLayout(
  persisted: LayoutItem[],
  specs: Array<{ id: string } & TileSpec>,
  options: PackOptions,
): LayoutItem[] {
  const persistedById = new Map(persisted.map((l) => [l.i, l]));
  const specById = new Map(specs.map((s) => [s.id, s]));

  const kept: LayoutItem[] = [];
  const skyline: number[] = new Array(options.columns).fill(0);

  // Seed the skyline with rendered footprints so newly measured aspect tiles
  // don't overlap siblings when their persisted h was stale.
  for (const spec of specs) {
    const p = persistedById.get(spec.id);
    if (!p) continue;
    const renderedH =
      spec.aspect && spec.aspect > 0
        ? chooseRows(spec, p.w, options)
        : p.h;
    const item = renderedH === p.h ? p : { ...p, h: renderedH };
    kept.push(item);
    for (let k = 0; k < item.w; k++) {
      const col = item.x + k;
      if (col >= 0 && col < options.columns) {
        skyline[col] = Math.max(skyline[col], item.y + item.h);
      }
    }
  }

  // Pack new (non-persisted) tiles. Aspect-locked tiles try the preferred span
  // first, then progressively smaller spans, picking the largest one whose
  // skyline placement still fits within the row budget. This means a hoodie
  // pasted into a tight gap shrinks to fit (preserving aspect) rather than
  // shooting past the canvas bottom. If even minSpan won't fit, we still place
  // it at minSpan; the caller (addItemWithSpill in home.tsx) sees the overflow
  // via tentativeBottom > maxRows and spills to the next page.
  for (const spec of specs) {
    if (persistedById.has(spec.id)) continue;
    const placement = placeFresh(spec, skyline, options);

    for (let k = 0; k < placement.w; k++) {
      skyline[placement.x + k] = placement.y + placement.h;
    }

    kept.push({
      i: spec.id,
      x: placement.x,
      y: placement.y,
      w: placement.w,
      h: placement.h,
      ...(spec.minSpan != null && { minW: Math.min(spec.minSpan, placement.w) }),
      ...(spec.minRows != null && { minH: Math.min(spec.minRows, placement.h) }),
    });
  }

  // Drop any persisted positions for specs that no longer exist.
  const final = kept.filter((l) => specById.has(l.i));

  // If the merged layout overflows the row budget, the persisted arrangement
  // can't accommodate the new set of tiles. Re-pack from scratch so content
  // stays inside the viewport — users may lose custom positions, but they'll
  // never see cards clipped off-screen by the canvas's overflow-hidden.
  if (options.maxRows && options.maxRows > 0) {
    const bottom = final.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    if (bottom > options.maxRows) {
      return packLayout(specs, options);
    }
  }

  return final;
}

/**
 * Find the lowest-y placement for a tile of width `w` against `skyline`, ties
 * broken left-to-right (matches packSkyline's behaviour).
 */
function lowestPlacement(
  skyline: number[],
  w: number,
  columns: number,
): { x: number; y: number } {
  let bestX = 0;
  let bestY = Number.POSITIVE_INFINITY;
  const span = Math.max(1, Math.min(columns, w));
  for (let x = 0; x <= columns - span; x++) {
    let y = 0;
    for (let k = 0; k < span; k++) y = Math.max(y, skyline[x + k]);
    if (y < bestY) {
      bestY = y;
      bestX = x;
    }
  }
  if (!Number.isFinite(bestY)) bestY = 0;
  return { x: bestX, y: bestY };
}

/**
 * Pick a placement for a fresh (non-persisted) tile.
 *
 * Aspect-locked tiles adaptively shrink: try preferredSpan, then step down to
 * minSpan, and keep the largest span whose `y + h` fits in `maxRows`. Smaller
 * w → proportionally smaller h, so a tall portrait that doesn't fit at span=8
 * may still fit at span=4. If nothing fits, return the minSpan placement and
 * let the caller decide whether to spill (non-empty page) or accept overflow
 * (single-tile empty page).
 *
 * Flex tiles use the original chooseSpan/chooseRows result.
 */
function placeFresh(
  spec: { id: string } & TileSpec,
  skyline: number[],
  options: PackOptions,
): { x: number; y: number; w: number; h: number } {
  const { columns, maxRows } = options;
  const preferredSpan = chooseSpan(spec, options);

  if (spec.aspect && spec.aspect > 0 && maxRows && maxRows > 0) {
    const minSpan = Math.max(1, Math.min(preferredSpan, spec.minSpan ?? 3));
    for (let w = preferredSpan; w >= minSpan; w--) {
      const h = chooseRows(spec, w, options);
      const { x, y } = lowestPlacement(skyline, w, columns);
      if (y + h <= maxRows) return { x, y, w, h };
    }
    // Nothing fits — fall through to minSpan placement (overflow allowed).
    const w = minSpan;
    const h = chooseRows(spec, w, options);
    const { x, y } = lowestPlacement(skyline, w, columns);
    return { x, y, w, h };
  }

  const w = preferredSpan;
  const h = chooseRows(spec, w, options);
  const { x, y } = lowestPlacement(skyline, w, columns);
  return { x, y, w, h };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
