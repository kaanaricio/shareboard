import { describe, expect, test } from "bun:test";
import {
  chooseRows,
  chooseSpan,
  colSpanToPx,
  mergeLayout,
  packLayout,
  packSkyline,
  pxToRows,
  resolveDisplacedLayout,
  rowsToPx,
} from "./pack";
import type { TileSpec } from "./types";

const OPTS = {
  columns: 24,
  containerWidth: 1440,
  rowHeight: 20,
  gap: 12,
  maxRows: 30,
};

describe("colSpanToPx / pxToColSpan", () => {
  test("full-column span equals container width", () => {
    expect(colSpanToPx(OPTS.columns, OPTS)).toBeCloseTo(OPTS.containerWidth, 5);
  });
  test("pxToRows and rowsToPx are inverses", () => {
    const px = rowsToPx(7, OPTS);
    expect(pxToRows(px, OPTS)).toBeCloseTo(7, 5);
  });
});

describe("chooseSpan", () => {
  test("respects maxWidthPx, then rounds down to a row-tiling span", () => {
    const span = chooseSpan({ aspect: 2, maxWidthPx: 550, minSpan: 3 }, OPTS);
    expect(colSpanToPx(span, OPTS)).toBeLessThanOrEqual(550);
    expect(span).toBe(8);
  });
  test("falls back to minSpan when minSpan already exceeds maxWidthPx", () => {
    const narrow = { ...OPTS, containerWidth: 3840 };
    const span = chooseSpan({ maxWidthPx: 300, minSpan: 4 }, narrow);
    expect(span).toBe(4);
  });
  test("rounds preferredSpan down to a row-tiling span", () => {
    expect(chooseSpan({ preferredSpan: 10 }, OPTS)).toBe(8);
  });
  test("clamps preferredSpan to minSpan", () => {
    expect(chooseSpan({ preferredSpan: 1, minSpan: 4 }, OPTS)).toBe(4);
  });
});

describe("chooseRows", () => {
  test("derives height from aspect", () => {
    // aspect 2 (landscape) + span 10 on OPTS: pxW ≈ 593 → pxH ≈ 296 → rows ~= 10
    const rows = chooseRows({ aspect: 2 }, 10, OPTS);
    const pxW = colSpanToPx(10, OPTS);
    const expected = pxToRows(pxW / 2, OPTS);
    expect(rows).toBe(Math.max(3, Math.round(expected)));
  });
  test("uses preferredRows when aspect absent", () => {
    expect(chooseRows({ preferredRows: 12 }, 8, OPTS)).toBe(12);
  });
  test("respects minRows", () => {
    expect(chooseRows({ preferredRows: 1, minRows: 5 }, 8, OPTS)).toBe(5);
  });
});

describe("packSkyline", () => {
  test("places single tile at (0, 0)", () => {
    const out = packSkyline([{ id: "a", w: 8, h: 6 }], OPTS);
    expect(out).toEqual([
      expect.objectContaining({ i: "a", x: 0, y: 0, w: 8, h: 6 }),
    ]);
  });
  test("wraps to next row when row is full", () => {
    const out = packSkyline(
      [
        { id: "a", w: 12, h: 4 },
        { id: "b", w: 12, h: 4 },
        { id: "c", w: 12, h: 4 },
      ],
      OPTS,
    );
    expect(out[0]).toMatchObject({ x: 0, y: 0 });
    expect(out[1]).toMatchObject({ x: 12, y: 0 });
    expect(out[2]).toMatchObject({ x: 0, y: 4 });
  });
  test("tucks short tile into the short column (masonry)", () => {
    // Place a tall left tile + a short right tile + a third — the third should
    // tuck under the short right tile, not start a new row below the tall one.
    const out = packSkyline(
      [
        { id: "tall", w: 12, h: 10 },
        { id: "short", w: 12, h: 4 },
        { id: "filler", w: 12, h: 4 },
      ],
      OPTS,
    );
    expect(out[0]).toMatchObject({ i: "tall", x: 0, y: 0, h: 10 });
    expect(out[1]).toMatchObject({ i: "short", x: 12, y: 0, h: 4 });
    expect(out[2]).toMatchObject({ i: "filler", x: 12, y: 4, h: 4 });
  });
  test("preserves insertion order (no hidden sort)", () => {
    const out = packSkyline(
      [
        { id: "first", w: 6, h: 4 },
        { id: "second", w: 6, h: 8 },
        { id: "third", w: 6, h: 4 },
      ],
      OPTS,
    );
    expect(out.map((l) => l.i)).toEqual(["first", "second", "third"]);
  });
});

describe("packLayout", () => {
  test("empty input produces empty layout", () => {
    expect(packLayout([], OPTS)).toEqual([]);
  });
  test("scales heights down to respect minRows when layout would slightly overflow", () => {
    // 4 tiles × preferredRows=20, packed 2 per row (preferredSpan=12) → 40 rows deep.
    // maxRows=12 → scale ≈ 0.3 → each h = max(3, 6) = 6. Bottom = 6×2 = 12. Fits.
    const specs: Array<{ id: string } & TileSpec> = Array.from({ length: 4 }, (_, i) => ({
      id: `tile${i}`,
      preferredSpan: 12,
      preferredRows: 20,
      minRows: 3,
    }));
    const packed = packLayout(specs, { ...OPTS, maxRows: 12 });
    const bottom = packed.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    expect(bottom).toBeLessThanOrEqual(12);
    expect(packed).toHaveLength(4);
  });
  test("lets layout overflow rather than crushing tiles below minRows", () => {
    // Budget too tight for even minRows-respecting packing (5 stacked rows × minRows 3 = 15 > 10).
    // Packer should keep tiles at minRows and let canvas scrolling handle the overflow.
    const specs: Array<{ id: string } & TileSpec> = Array.from({ length: 10 }, (_, i) => ({
      id: `tile${i}`,
      preferredSpan: 12,
      preferredRows: 20,
      minRows: 3,
    }));
    const packed = packLayout(specs, { ...OPTS, maxRows: 10 });
    expect(packed).toHaveLength(10);
    for (const l of packed) {
      expect(l.h).toBeGreaterThanOrEqual(3); // no crush below minRows
    }
  });
  test("aspect-locked tiles get heights derived from span", () => {
    const packed = packLayout(
      [{ id: "square", aspect: 1, preferredSpan: 8, minSpan: 3 }],
      OPTS,
    );
    // Square tile: pxW == pxH, so h == w approximately (after rowHeight+gap conversion).
    // pxW(8) ≈ 472, rows for pxH=472 with rowHeight=20 gap=12 = (472+12)/(20+12) ≈ 15.125 → 15.
    expect(packed[0].h).toBe(15);
  });
});

describe("mergeLayout", () => {
  test("keeps persisted x/y/h for known ids (w may grow via justify-flex)", () => {
    const persisted = [
      { i: "a", x: 6, y: 0, w: 6, h: 5, minW: 3, minH: 3 },
    ];
    const merged = mergeLayout(
      persisted,
      [{ id: "a", preferredSpan: 12, preferredRows: 10 }],
      OPTS,
    );
    expect(merged).toHaveLength(1);
    // x/y/h preserved exactly; w may be stretched to fill remaining row space.
    expect(merged[0]).toMatchObject({ i: "a", x: 6, y: 0, h: 5 });
    expect(merged[0].w).toBeGreaterThanOrEqual(6);
  });
  test("packs new ids around persisted tiles", () => {
    const persisted = [{ i: "old", x: 0, y: 0, w: 12, h: 6 }];
    const merged = mergeLayout(
      persisted,
      [
        { id: "old", preferredSpan: 12, preferredRows: 6 },
        { id: "new", preferredSpan: 12, preferredRows: 6 },
      ],
      OPTS,
    );
    const newTile = merged.find((l) => l.i === "new")!;
    // New tile should tuck next to old (x=12, y=0), not below (y=6).
    expect(newTile).toMatchObject({ x: 12, y: 0 });
  });
  test("preserves persisted positions and reports overflow when a merge cannot fit", () => {
    // Simulate a canvas that's already at the row budget, then add one more tile.
    const persisted = [
      { i: "a", x: 0, y: 0, w: 12, h: 5 },
      { i: "b", x: 12, y: 0, w: 12, h: 5 },
      { i: "c", x: 0, y: 5, w: 12, h: 5 },
      { i: "d", x: 12, y: 5, w: 12, h: 5 },
    ];
    const merged = mergeLayout(
      persisted,
      [
        { id: "a", preferredSpan: 12, preferredRows: 5 },
        { id: "b", preferredSpan: 12, preferredRows: 5 },
        { id: "c", preferredSpan: 12, preferredRows: 5 },
        { id: "d", preferredSpan: 12, preferredRows: 5 },
        { id: "e", preferredSpan: 12, preferredRows: 5 }, // the one that would overflow
      ],
      { ...OPTS, maxRows: 10 },
    );
    const bottom = merged.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    expect(bottom).toBeGreaterThan(10);
    expect(merged.find((l) => l.i === "a")).toMatchObject({ x: 0, y: 0, w: 12, h: 5 });
    expect(merged.find((l) => l.i === "d")).toMatchObject({ x: 12, y: 5, w: 12, h: 5 });
    expect(merged.map((l) => l.i).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
  test("drops stale persisted ids that no longer exist in specs", () => {
    const merged = mergeLayout(
      [{ i: "zombie", x: 0, y: 0, w: 4, h: 4 }],
      [{ id: "fresh", preferredSpan: 4, preferredRows: 4 }],
      OPTS,
    );
    expect(merged.map((l) => l.i)).toEqual(["fresh"]);
  });
  test("normalizes persisted layouts back inside the grid and row budget", () => {
    const merged = mergeLayout(
      [
        { i: "wide", x: -5, y: -2, w: 40, h: 6, minW: 30 },
        { i: "low", x: 20, y: 99, w: 8, h: 12, minH: 30 },
      ],
      [
        { id: "wide", preferredSpan: 8, preferredRows: 6 },
        { id: "low", preferredSpan: 8, preferredRows: 12 },
      ],
      { ...OPTS, maxRows: 18 },
    );

    expect(merged.find((l) => l.i === "wide")).toMatchObject({ x: 0, y: 0, w: 24 });
    expect(merged.find((l) => l.i === "wide")?.minW).toBe(24);
    const low = merged.find((l) => l.i === "low")!;
    expect(low.x + low.w).toBeLessThanOrEqual(OPTS.columns);
    expect(low.y + low.h).toBeLessThanOrEqual(18);
    expect(low.minH).toBe(low.h);
  });
  test("repacks overlapping persisted layouts instead of preserving collisions", () => {
    const merged = mergeLayout(
      [
        { i: "a", x: 0, y: 0, w: 12, h: 6 },
        { i: "b", x: 0, y: 0, w: 12, h: 6 },
      ],
      [
        { id: "a", preferredSpan: 12, preferredRows: 6 },
        { id: "b", preferredSpan: 12, preferredRows: 6 },
      ],
      OPTS,
    );

    expect(merged.find((l) => l.i === "a")).toMatchObject({ x: 0, y: 0 });
    expect(merged.find((l) => l.i === "b")).toMatchObject({ x: 12, y: 0 });
  });
  test("drops malformed persisted coordinates and repacks the tile", () => {
    const merged = mergeLayout(
      [{ i: "bad", x: Number.NaN, y: 0, w: 8, h: 6 }],
      [{ id: "bad", preferredSpan: 8, preferredRows: 6 }],
      OPTS,
    );

    expect(merged).toEqual([expect.objectContaining({ i: "bad", x: 0, y: 0, w: 8, h: 6 })]);
  });
  test("empty persisted layout equals packLayout", () => {
    const specs: Array<{ id: string } & TileSpec> = [
      { id: "a", preferredSpan: 8, preferredRows: 6 },
      { id: "b", preferredSpan: 8, preferredRows: 6 },
    ];
    const merged = mergeLayout([], specs, OPTS);
    const packed = packLayout(specs, OPTS);
    expect(merged.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))).toEqual(
      packed.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
    );
  });
});

describe("resolveDisplacedLayout", () => {
  test("swaps a displaced card into the moved card's vacated slot", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
    ];
    const next = [
      { i: "a", x: 8, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
    ];

    const resolved = resolveDisplacedLayout(next, before, "a", { columns: 24, maxRows: 12 });

    expect(resolved?.find((item) => item.i === "a")).toMatchObject({ x: 8, y: 0 });
    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 0, y: 0 });
  });

  test("inserts through a same-size row instead of directly swapping endpoints", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
      { i: "c", x: 16, y: 0, w: 8, h: 6 },
    ];
    const next = [
      { i: "a", x: 16, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
      { i: "c", x: 16, y: 0, w: 8, h: 6 },
    ];

    const resolved = resolveDisplacedLayout(next, before, "a", { columns: 24, maxRows: 6 });

    expect(resolved?.find((item) => item.i === "a")).toMatchObject({ x: 16, y: 0 });
    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 0, y: 0 });
    expect(resolved?.find((item) => item.i === "c")).toMatchObject({ x: 8, y: 0 });
  });

  test("pushes a partially overlapped card in the drag direction when space exists", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
    ];
    const next = [
      { i: "a", x: 4, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
    ];

    const resolved = resolveDisplacedLayout(next, before, "a", { columns: 24, maxRows: 12 });

    expect(resolved?.find((item) => item.i === "a")).toMatchObject({ x: 4, y: 0 });
    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 12, y: 0 });
  });

  test("returns null when no non-overlapping displaced layout fits", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 18, h: 6 },
    ];
    const next = [
      { i: "a", x: 6, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 18, h: 6 },
    ];

    expect(resolveDisplacedLayout(next, before, "a", { columns: 24, maxRows: 6 })).toBeNull();
  });

  test("finds a legal displaced slot when there is no row budget", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 12, h: 6 },
      { i: "b", x: 12, y: 0, w: 12, h: 6 },
      { i: "c", x: 0, y: 6, w: 12, h: 6 },
    ];
    const next = [
      { i: "a", x: 12, y: 0, w: 12, h: 6 },
      { i: "b", x: 12, y: 0, w: 12, h: 6 },
      { i: "c", x: 0, y: 6, w: 12, h: 6 },
    ];

    const resolved = resolveDisplacedLayout(next, before, "a", { columns: 24 });

    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 0, y: 0 });
  });
});

describe("row-tiling widths", () => {
  test("keeps a lone flex tile at its row-tiling width", () => {
    const packed = packLayout(
      [{ id: "note", preferredSpan: 8, preferredRows: 5 }],
      OPTS,
    );
    expect(packed[0].w).toBe(8);
  });
  test("does not stretch aspect-locked tiles past their row-tiling cap", () => {
    const packed = packLayout(
      [{ id: "tweet", aspect: 1.2, maxWidthPx: 550, minSpan: 4 }],
      OPTS,
    );
    const px = packed[0].w * ((OPTS.containerWidth - OPTS.gap * (OPTS.columns - 1)) / OPTS.columns) + OPTS.gap * (packed[0].w - 1);
    expect(px).toBeLessThanOrEqual(550);
  });
  test("keeps mixed rows on the same tiling span", () => {
    const packed = packLayout(
      [
        { id: "tweet", aspect: 1.2, maxWidthPx: 550, minSpan: 4 },
        { id: "note", preferredSpan: 8, preferredRows: 6 },
      ],
      OPTS,
    );
    const tweet = packed.find((l) => l.i === "tweet")!;
    const note = packed.find((l) => l.i === "note")!;
    expect(tweet.y).toBe(0);
    expect(note.y).toBe(0);
    expect(tweet.w).toBe(8);
    expect(note.w).toBe(8);
  });
});

describe("regression — tweet placement realism", () => {
  test("a 1.2-aspect tweet on a typical laptop viewport lands near its 550px natural width", () => {
    // 1.2 is wider-than-tall, realistic for a short-text tweet.
    const spec: TileSpec = {
      aspect: 1.2,
      maxWidthPx: 550,
      minSpan: 4,
      preferredRows: 16,
    };
    const span = chooseSpan(spec, OPTS);
    const pxW = colSpanToPx(span, OPTS);
    expect(pxW).toBeGreaterThan(460); // not tiny
    expect(pxW).toBeLessThanOrEqual(550); // not oversized
  });
  test("narrow lg viewport doesn't give tweet a sub-4-col span", () => {
    const narrow = { ...OPTS, containerWidth: 768 };
    const spec: TileSpec = { aspect: 1.5, maxWidthPx: 550, minSpan: 4 };
    expect(chooseSpan(spec, narrow)).toBeGreaterThanOrEqual(4);
  });
});
