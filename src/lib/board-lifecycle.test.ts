import { describe, expect, test } from "bun:test";
import {
  __boardLifecyclePolicyForTests,
  addItemWithSpillToPages,
  duplicateItemWithSpillToPages,
  editorPagesFromCanvas,
  emptyBoardPage,
  removeItemsFromPage,
} from "./board-lifecycle";
import { BOARD_SUMMARY_ITEM_ID, type BoardPage } from "./types";

const layouts = { lg: [], sm: [] };

describe("board lifecycle", () => {
  test("restores shared boards into editable pages with a synthetic summary card", () => {
    const pages = editorPagesFromCanvas({
      id: "shared",
      author: "Ada",
      createdAt: "2026-05-01T00:00:00.000Z",
      generation: {
        item_summaries: [],
        overall_summary: { title: "Summary", explanation: "", tags: [] },
      },
      pages: [
        {
          id: "page",
          items: [{ id: "note", type: "note", text: "hello" }],
        },
      ],
    });

    expect(pages).toEqual([
      {
        id: "page",
        layouts,
        items: [
          { id: "note", type: "note", text: "hello" },
          { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" },
        ],
      },
    ]);
  });

  test("removes items and their persisted layout entries together", () => {
    const page: BoardPage = {
      id: "page",
      items: [
        { id: "keep", type: "note", text: "keep" },
        { id: "drop", type: "note", text: "drop" },
      ],
      layouts: {
        lg: [
          { i: "keep", x: 0, y: 0, w: 4, h: 4 },
          { i: "drop", x: 4, y: 0, w: 4, h: 4 },
        ],
        sm: [
          { i: "keep", x: 0, y: 0, w: 1, h: 4 },
          { i: "drop", x: 0, y: 4, w: 1, h: 4 },
        ],
      },
    };

    const next = removeItemsFromPage(page, new Set(["drop"]));

    expect(next.items.map((item) => item.id)).toEqual(["keep"]);
    expect(next.layouts.lg.map((item) => item.i)).toEqual(["keep"]);
    expect(next.layouts.sm.map((item) => item.i)).toEqual(["keep"]);
  });

  test("removes draft-image previews via adapter while applying pure state removal", () => {
    const page: BoardPage = {
      id: "page",
      items: [
        {
          id: "img",
          type: "image",
          file: new File(["x"], "x.png", { type: "image/png" }),
          previewUrl: "blob:img",
        },
        { id: "note", type: "note", text: "keep" },
      ],
      layouts: {
        lg: [
          { i: "img", x: 0, y: 0, w: 4, h: 4 },
          { i: "note", x: 4, y: 0, w: 4, h: 4 },
        ],
        sm: [
          { i: "img", x: 0, y: 0, w: 1, h: 4 },
          { i: "note", x: 0, y: 4, w: 1, h: 4 },
        ],
      },
    };
    const revoked: string[] = [];
    const ids = new Set(["img"]);

    const next = removeItemsFromPage(page, ids, {
      create() {
        throw new Error("not used");
      },
      revoke(url) {
        revoked.push(url);
      },
    });

    const pure = __boardLifecyclePolicyForTests.removeItemsFromPageState(page, ids);
    expect(next).toEqual(pure);
    expect(revoked).toEqual(["blob:img"]);
  });

  test("duplicates draft images via preview adapter", () => {
    const page: BoardPage = {
      id: "page",
      items: [
        {
          id: "img",
          type: "image",
          file: new File(["x"], "x.png", { type: "image/png" }),
          previewUrl: "blob:old",
        },
      ],
      layouts: { lg: [], sm: [] },
    };
    const created: string[] = [];
    const result = duplicateItemWithSpillToPages({
      pages: [page],
      activePage: 0,
      id: "img",
      maxRows: 100,
      adapter: {
        create(file) {
          created.push(file.name);
          return "blob:new";
        },
        revoke() {
          throw new Error("not used");
        },
      },
    });

    expect(result).not.toBeNull();
    expect(created).toEqual(["x.png"]);
    expect(result!.landedIndex).toBe(0);
    const duplicated = result!.pages[0]!.items.find((item) => item.id === result!.newId);
    expect(duplicated).toMatchObject({ type: "image", previewUrl: "blob:new" });
  });

  test("shrinks duplicated images into real gaps, then spills instead of repacking the page", () => {
    const file = new File(["x"], "avatar.png", { type: "image/png" });
    const img = (id: string) => ({
      id,
      type: "image" as const,
      file,
      previewUrl: `blob:${id}`,
      aspect: 1,
    });
    const page: BoardPage = {
      id: "page",
      items: ["a", "b", "c", "d", "e", "f", "g"].map(img),
      layouts: {
        lg: [
          { i: "a", x: 0, y: 0, w: 8, h: 13 },
          { i: "b", x: 8, y: 0, w: 8, h: 13 },
          { i: "c", x: 16, y: 0, w: 8, h: 13 },
          { i: "d", x: 0, y: 13, w: 5, h: 8 },
          { i: "e", x: 5, y: 13, w: 5, h: 8 },
          { i: "f", x: 10, y: 13, w: 5, h: 8 },
          { i: "g", x: 15, y: 13, w: 5, h: 8 },
        ],
        sm: [],
      },
    };

    const first = duplicateItemWithSpillToPages({
      pages: [page],
      activePage: 0,
      id: "g",
      maxRows: 21,
      adapter: {
        create() {
          return "blob:copy";
        },
        revoke() {
          throw new Error("not used");
        },
      },
    });

    expect(first).not.toBeNull();
    expect(first!.landedIndex).toBe(0);
    expect(first!.pages).toHaveLength(1);
    expect(first!.pages[0]!.items).toHaveLength(8);
    expect(first!.pages[0]!.layouts.lg.find((layout) => layout.i === first!.newId)).toMatchObject({
      x: 20,
      y: 13,
      w: 4,
      h: 6,
    });

    const second = duplicateItemWithSpillToPages({
      pages: first!.pages,
      activePage: 0,
      id: first!.newId,
      maxRows: 21,
      adapter: {
        create() {
          return "blob:copy-2";
        },
        revoke() {
          throw new Error("not used");
        },
      },
    });

    expect(second).not.toBeNull();
    expect(second!.landedIndex).toBe(1);
    expect(second!.pages).toHaveLength(2);
    expect(second!.pages[0]!.layouts.lg).toEqual(first!.pages[0]!.layouts.lg);
    expect(second!.pages[1]!.items).toEqual([
      expect.objectContaining({ id: second!.newId, type: "image", previewUrl: "blob:copy-2" }),
    ]);
  });

  test("keeps duplicated images at source size when that footprint fits", () => {
    const file = new File(["x"], "avatar.png", { type: "image/png" });
    const img = (id: string) => ({
      id,
      type: "image" as const,
      file,
      previewUrl: `blob:${id}`,
      aspect: 1,
    });
    const page: BoardPage = {
      id: "page",
      items: ["a", "b", "source"].map(img),
      layouts: {
        lg: [
          { i: "a", x: 0, y: 0, w: 8, h: 13 },
          { i: "b", x: 8, y: 0, w: 8, h: 13 },
          { i: "source", x: 0, y: 13, w: 5, h: 8 },
        ],
        sm: [],
      },
    };

    const result = duplicateItemWithSpillToPages({
      pages: [page],
      activePage: 0,
      id: "source",
      maxRows: 21,
      adapter: {
        create() {
          return "blob:copy";
        },
        revoke() {
          throw new Error("not used");
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.landedIndex).toBe(0);
    expect(result!.pages[0]!.layouts.lg.find((layout) => layout.i === result!.newId)).toMatchObject({
      w: 5,
      h: 8,
    });
  });

  test("spills a new item to the next page when the active page is full", () => {
    const fullPage: BoardPage = {
      id: "full",
      items: [{ id: "a", type: "note", text: "A".repeat(500) }],
      layouts: { lg: [{ i: "a", x: 0, y: 0, w: 24, h: 4 }], sm: [] },
    };

    const result = addItemWithSpillToPages({
      pages: [fullPage],
      activePage: 0,
      item: { id: "b", type: "note", text: "B".repeat(500) },
      maxRows: 1,
    });

    expect(result.landedIndex).toBe(1);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.items.map((item) => item.id)).toEqual(["a"]);
    expect(result.pages[1]?.items.map((item) => item.id)).toEqual(["b"]);
  });

  test("continues past existing full pages instead of overfilling the next page", () => {
    const fullPage = (id: string, itemId: string): BoardPage => ({
      id,
      items: [{ id: itemId, type: "note", text: "x" }],
      layouts: { lg: [{ i: itemId, x: 0, y: 0, w: 24, h: 4 }], sm: [] },
    });

    const result = addItemWithSpillToPages({
      pages: [fullPage("p1", "a"), fullPage("p2", "b")],
      activePage: 0,
      item: { id: "c", type: "note", text: "new" },
      maxRows: 3,
    });

    expect(result.landedIndex).toBe(2);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]?.items.map((item) => item.id)).toEqual(["a"]);
    expect(result.pages[1]?.items.map((item) => item.id)).toEqual(["b"]);
    expect(result.pages[2]?.items.map((item) => item.id)).toEqual(["c"]);
  });

  test("bulk image placement keeps every populated page within the row budget", () => {
    const file = new File(["x"], "avatar.webp", { type: "image/webp" });
    let pages = [emptyBoardPage()];
    let pageIndex = 0;

    for (let index = 0; index < 24; index++) {
      const result = addItemWithSpillToPages({
        pages,
        activePage: pageIndex,
        item: {
          id: `img-${index}`,
          type: "image",
          file,
          previewUrl: `blob:${index}`,
          aspect: 1,
          size: file.size,
        },
        maxRows: 21,
      });
      pages = result.pages;
      pageIndex = result.landedIndex;
    }

    expect(pages.flatMap((page) => page.items)).toHaveLength(24);
    for (const page of pages) {
      const bottom = page.layouts.lg.reduce((max, layout) => Math.max(max, layout.y + layout.h), 0);
      expect(bottom).toBeLessThanOrEqual(21);
    }
  });

  test("creates empty editable pages with required layout containers", () => {
    const page = emptyBoardPage();
    expect(page.items).toEqual([]);
    expect(page.layouts).toEqual(layouts);
  });
});
