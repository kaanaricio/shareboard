import { describe, expect, test } from "bun:test";
import { __draftPolicyForTests, draftLayoutSignature, draftSignature } from "./local-draft";
import type { BoardPage } from "./types";

describe("local draft policy", () => {
  test("strips transient previewUrl fields before persistence", () => {
    const pages: BoardPage[] = [
      {
        id: "p1",
        layouts: { lg: [], sm: [] },
        items: [
          {
            id: "img",
            type: "image",
            file: new File(["x"], "a.png", { type: "image/png" }),
            previewUrl: "blob:old",
            caption: "caption",
          },
        ],
      },
    ];

    const snapshot = __draftPolicyForTests.createStoredDraftSnapshot(pages, null, { kind: "draft" });
    const storedItem = snapshot.pages[0]?.items[0] as Record<string, unknown>;

    expect(storedItem.previewUrl).toBeUndefined();
    expect(storedItem.file).toBeInstanceOf(File);
  });

  test("rehydrates draft image preview URLs from persisted files", () => {
    const pages: BoardPage[] = [
      {
        id: "p1",
        layouts: { lg: [], sm: [] },
        items: [
          {
            id: "img",
            type: "image",
            file: new File(["x"], "a.png", { type: "image/png" }),
            previewUrl: "blob:old",
          },
        ],
      },
    ];
    const snapshot = __draftPolicyForTests.createStoredDraftSnapshot(pages, null, { kind: "draft" });

    const restored = __draftPolicyForTests.restoreStoredDraftSnapshot(snapshot, {
      createPreviewUrl() {
        return "blob:new";
      },
      isFile(value): value is File {
        return value instanceof File;
      },
    });

    expect(restored).not.toBeNull();
    expect(restored?.pages[0]?.items[0]).toMatchObject({ type: "image", previewUrl: "blob:new" });
  });

  test("strips runtime layout fields before persistence", () => {
    const pages: BoardPage[] = [
      {
        id: "p1",
        items: [{ id: "note", type: "note", text: "hello" }],
        layouts: {
          lg: [
            {
              i: "note",
              x: 1,
              y: 2,
              w: 3,
              h: 4,
              minW: 2,
              constrainPosition() {
                return { x: 0, y: 0 };
              },
            } as never,
          ],
          sm: [],
        },
      },
    ];

    const storedLayout = __draftPolicyForTests.createStoredDraftSnapshot(pages, null).pages[0]?.layouts.lg[0] as
      | Record<string, unknown>
      | undefined;

    expect(storedLayout).toEqual({ i: "note", x: 1, y: 2, w: 3, h: 4, minW: 2 });
    expect(storedLayout?.constrainPosition).toBeUndefined();
  });

  test("draft signature stays stable across layout-only changes", () => {
    const base: BoardPage[] = [
      {
        id: "p1",
        items: [{ id: "note", type: "note", text: "hello" }],
        layouts: { lg: [{ i: "note", x: 0, y: 0, w: 4, h: 2 }], sm: [] },
      },
    ];
    const moved: BoardPage[] = [
      {
        id: "p1",
        items: [{ id: "note", type: "note", text: "hello" }],
        layouts: { lg: [{ i: "note", x: 6, y: 8, w: 4, h: 2 }], sm: [{ i: "note", x: 0, y: 3, w: 1, h: 2 }] },
      },
    ];

    expect(draftSignature(base, null, { kind: "draft" })).toBe(
      draftSignature(moved, null, { kind: "draft" }),
    );
    expect(draftLayoutSignature(base)).not.toBe(draftLayoutSignature(moved));
  });
});
