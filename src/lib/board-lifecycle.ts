import { nanoid } from "nanoid";
import { mergeLayout } from "@/components/ui/auto-canvas";
import {
  LG_COLS,
  MARGIN,
  ROW_HEIGHT,
  buildSpecList,
  estimateContainerWidth,
} from "@/lib/tile-specs";
import {
  BOARD_SUMMARY_ITEM_ID,
  isDraftImageItem,
  type BoardPage,
  type Canvas as SharedCanvasData,
  type CanvasItem,
  type GridLayouts,
} from "@/lib/types";

interface PreviewUrlAdapter {
  create(file: File): string;
  revoke(url: string): void;
}

const browserPreviewUrlAdapter: PreviewUrlAdapter = {
  create(file) {
    return URL.createObjectURL(file);
  },
  revoke(url) {
    URL.revokeObjectURL(url);
  },
};

export function emptyBoardPage(): BoardPage {
  return { id: nanoid(8), items: [], layouts: { lg: [], sm: [] } };
}

export function packPageLayouts(items: CanvasItem[], prev: GridLayouts, maxRows: number): GridLayouts {
  const specs = buildSpecList(items);
  const containerWidth = estimateContainerWidth();
  return {
    lg: mergeLayout(prev.lg, specs, {
      columns: LG_COLS,
      containerWidth,
      rowHeight: ROW_HEIGHT,
      gap: MARGIN,
      maxRows,
    }),
    sm: mergeLayout(prev.sm, specs, {
      columns: 1,
      containerWidth,
      rowHeight: ROW_HEIGHT,
      gap: MARGIN,
    }),
  };
}

export function editorPagesFromCanvas(canvas: SharedCanvasData): BoardPage[] {
  if (canvas.pages.length === 0) return [emptyBoardPage()];
  return canvas.pages.map((page, idx) => {
    const baseItems = page.items.filter((item) => item.type !== "board_summary");
    const items: CanvasItem[] =
      idx === 0 && canvas.generation
        ? [...baseItems, { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" }]
        : baseItems;
    return {
      id: page.id || nanoid(8),
      items,
      layouts: page.layouts ?? { lg: [], sm: [] },
    };
  });
}

function draftPreviewUrlsOnPage(page: BoardPage): string[] {
  const urls: string[] = [];
  for (const item of page.items) {
    if (isDraftImageItem(item)) urls.push(item.previewUrl);
  }
  return urls;
}

function removeItemsFromPageState(page: BoardPage, ids: ReadonlySet<string>): BoardPage {
  if (ids.size === 0) return page;
  return {
    ...page,
    items: page.items.filter((item) => !ids.has(item.id)),
    layouts: {
      lg: page.layouts.lg.filter((layout) => !ids.has(layout.i)),
      sm: page.layouts.sm.filter((layout) => !ids.has(layout.i)),
    },
  };
}

function previewUrlsForRemovedItems(page: BoardPage, ids: ReadonlySet<string>): string[] {
  if (ids.size === 0) return [];
  const urls: string[] = [];
  for (const item of page.items) {
    if (ids.has(item.id) && isDraftImageItem(item)) urls.push(item.previewUrl);
  }
  return urls;
}

export function revokeDraftImagePreviews(
  pages: readonly BoardPage[],
  adapter: PreviewUrlAdapter = browserPreviewUrlAdapter,
) {
  for (const page of pages) {
    for (const url of draftPreviewUrlsOnPage(page)) adapter.revoke(url);
  }
}

export function removeItemsFromPage(
  page: BoardPage,
  ids: ReadonlySet<string>,
  adapter: PreviewUrlAdapter = browserPreviewUrlAdapter,
): BoardPage {
  for (const url of previewUrlsForRemovedItems(page, ids)) adapter.revoke(url);
  return removeItemsFromPageState(page, ids);
}

export function duplicateItemWithSpillToPages({
  pages,
  activePage,
  id,
  maxRows,
  adapter = browserPreviewUrlAdapter,
}: {
  pages: BoardPage[];
  activePage: number;
  id: string;
  maxRows: number;
  adapter?: PreviewUrlAdapter;
}): { pages: BoardPage[]; landedIndex: number; newId: string } | null {
  if (id === BOARD_SUMMARY_ITEM_ID) return null;
  const source = pages[activePage]?.items.find((item) => item.id === id);
  if (!source || source.type === "board_summary") return null;
  const newId = nanoid(10);
  const copy = isDraftImageItem(source)
    ? { ...source, id: newId, previewUrl: adapter.create(source.file) }
    : { ...source, id: newId };
  if (source.type === "image") {
    const exact = addImageDuplicateAtSourceSize({ pages, activePage, sourceId: id, item: copy, maxRows });
    if (exact) return { ...exact, newId };
  }
  const result = addItemWithSpillToPages({ pages, activePage, item: copy, maxRows });
  return { ...result, newId };
}

function addImageDuplicateAtSourceSize({
  pages,
  activePage,
  sourceId,
  item,
  maxRows,
}: {
  pages: BoardPage[];
  activePage: number;
  sourceId: string;
  item: CanvasItem;
  maxRows: number;
}): { pages: BoardPage[]; landedIndex: number } | null {
  const active = pages[activePage];
  const sourceLayout = active?.layouts.lg.find((layout) => layout.i === sourceId);
  if (!active || !sourceLayout) return null;

  const { x, y } = lowestOpenSlot(active.layouts.lg, sourceLayout.w, LG_COLS);
  const candidate = {
    ...sourceLayout,
    i: item.id,
    x,
    y,
    w: sourceLayout.w,
    h: sourceLayout.h,
  };
  if (candidate.y + candidate.h > maxRows) return null;

  const items = [...active.items, item];
  const layouts = packPageLayouts(
    items,
    { ...active.layouts, lg: [...active.layouts.lg, candidate] },
    maxRows,
  );
  const bottom = layouts.lg.reduce((max, layout) => Math.max(max, layout.y + layout.h), 0);
  if (bottom > maxRows) return null;

  const next = [...pages];
  next[activePage] = { ...active, items, layouts };
  return { pages: next, landedIndex: activePage };
}

function lowestOpenSlot(
  layouts: GridLayouts["lg"],
  width: number,
  columns: number,
): { x: number; y: number } {
  const w = Math.max(1, Math.min(columns, width));
  const skyline = new Array(columns).fill(0);
  for (const layout of layouts) {
    for (let k = 0; k < layout.w; k++) {
      const col = layout.x + k;
      if (col >= 0 && col < columns) skyline[col] = Math.max(skyline[col], layout.y + layout.h);
    }
  }

  let bestX = 0;
  let bestY = Number.POSITIVE_INFINITY;
  for (let x = 0; x <= columns - w; x++) {
    let y = 0;
    for (let k = 0; k < w; k++) y = Math.max(y, skyline[x + k]);
    if (y < bestY) {
      bestX = x;
      bestY = y;
    }
  }
  return { x: bestX, y: Number.isFinite(bestY) ? bestY : 0 };
}

export function addItemWithSpillToPages({
  pages,
  activePage,
  item,
  maxRows,
}: {
  pages: BoardPage[];
  activePage: number;
  item: CanvasItem;
  maxRows: number;
}): { pages: BoardPage[]; landedIndex: number } {
  const next = [...pages];
  const start = Math.max(0, activePage);

  for (let index = start; index < next.length; index++) {
    const target = next[index] ?? emptyBoardPage();
    const items = [...target.items, item];
    const layouts = packPageLayouts(items, target.layouts, maxRows);
    const bottom = layouts.lg.reduce((max, layout) => Math.max(max, layout.y + layout.h), 0);
    if (bottom <= maxRows) {
      next[index] = { ...target, items, layouts };
      return { pages: next, landedIndex: index };
    }
  }

  const landedIndex = next.length;
  const target = emptyBoardPage();
  const items = [...target.items, item];
  next[landedIndex] = {
    ...target,
    items,
    layouts: packPageLayouts(items, target.layouts, maxRows),
  };
  return { pages: next, landedIndex };
}

export const __boardLifecyclePolicyForTests = {
  draftPreviewUrlsOnPage,
  previewUrlsForRemovedItems,
  removeItemsFromPageState,
};
