import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useMountEffect } from "@/lib/use-mount-effect";
import { nanoid } from "nanoid";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { notify, notifyProgress, notifyWithUndo } from "@/lib/toast";
import { Canvas } from "@/components/canvas";
import { Toolbar } from "@/components/toolbar";
import { SetupCards } from "@/components/setup-dialog";
import { LockedShareDialog } from "@/components/locked-share-dialog";
import { BoardCarousel } from "@/components/board-carousel";
import { Toaster } from "@/components/ui/sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Download, Loader2, Save, Share2 } from "lucide-react";
import {
  addItemWithSpillToPages,
  duplicateItemWithSpillToPages,
  editorPagesFromCanvas,
  emptyBoardPage,
  packPageLayouts,
  pruneEmptyPages,
  removeItemsFromPage,
  revokeDraftImagePreviews,
} from "@/lib/board-lifecycle";
import { getApiKey, isSetup, useSyncedSetting } from "@/lib/store";
import {
  clearLocalDraft,
  draftLayoutSignature,
  draftSignature,
  loadLocalDraft,
  saveLocalDraft,
} from "@/lib/local-draft";
import { detectPlatform, isValidUrl } from "@/lib/platforms";
import { estimateMaxRowsFromViewport } from "@/lib/tile-specs";
import type {
  BoardPage,
  Canvas as SharedCanvasData,
  CanvasItem,
  GenerateResponse,
  GridLayouts,
  OGData,
} from "@/lib/types";
import { BOARD_SUMMARY_ITEM_ID, isDraftImageItem } from "@/lib/types";
import { IMAGE_POLICY, formatBytes, optimizeImageForShare } from "@/lib/image-policy";
import { copyText } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/fetch-helpers";
import type { BoardOrigin } from "@/lib/board-origin";
import { useShareFlows } from "@/components/use-share-flows";
import { importFromUrl } from "@/lib/board-import";
import { sanitizeGeneration } from "@/lib/canvas-sanitize";

function findSvgSource(html: string | null, text: string | null) {
  return html?.match(/<svg[\s\S]*<\/svg>/i)?.[0] ?? (text?.startsWith("<svg") ? text : null);
}

function createSvgFile(svgSource: string) {
  const withXmlns = svgSource.includes("xmlns=")
    ? svgSource
    : svgSource.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return new File([withXmlns], `shareboard-${Date.now()}.svg`, { type: "image/svg+xml" });
}

function findSharedUrl(types: readonly string[], get: (type: string) => string) {
  const uriList = get("text/uri-list")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (uriList && isValidUrl(uriList)) return uriList;

  const text = get("text/plain").trim();
  if (text && isValidUrl(text)) return text;

  if (!types.includes("text/html")) return null;
  const html = get("text/html");
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const anchor = doc.querySelector("a[href]") as HTMLAnchorElement | null;
  return anchor?.href && isValidUrl(anchor.href) ? anchor.href : null;
}

function looksLikeImageFilename(text: string) {
  return /^[^/\n\r]+\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(text.trim());
}

function cloneCanvasItem(item: CanvasItem): CanvasItem | null {
  if (item.id === BOARD_SUMMARY_ITEM_ID || item.type === "board_summary") return null;
  const id = nanoid(10);
  if (isDraftImageItem(item)) {
    return { ...item, id, previewUrl: URL.createObjectURL(item.file) };
  }
  return { ...item, id };
}

function mediaBytesForPages(pages: readonly BoardPage[]) {
  return pages.reduce(
    (n, p) => n + p.items.reduce((sum, item) => sum + (item.type === "image" ? item.size ?? 0 : 0), 0),
    0,
  );
}

function mediaBytesForItems(items: readonly CanvasItem[]) {
  return items.reduce((sum, item) => sum + (item.type === "image" ? item.size ?? 0 : 0), 0);
}

async function fileFingerprint(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `${file.type}:${file.size}:${hash >>> 0}`;
}

function imageFilesFromTransfer(data: DataTransfer) {
  const fromFiles = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  if (fromFiles.length > 0) return fromFiles;
  return Array.from(data.items)
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
}

function revokeImagePreviews(items: readonly CanvasItem[]) {
  for (const item of items) {
    if (isDraftImageItem(item)) URL.revokeObjectURL(item.previewUrl);
  }
}

type SelectionEvent = { metaKey?: boolean; ctrlKey?: boolean };

export function Home() {
  const navigate = useNavigate({ from: "/" });
  const search = useSearch({ from: "/" });
  const urlPage = search.page ?? 1;

  const [pages, setPages] = useState<BoardPage[]>(() => [emptyBoardPage()]);
  const [generation, setGeneration] = useState<GenerateResponse | null>(null);
  const [boardOrigin, setBoardOrigin] = useState<BoardOrigin>({ kind: "draft" });
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteDialogIds, setDeleteDialogIds] = useState<string[] | null>(null);
  const [maxRows, setMaxRows] = useState(estimateMaxRowsFromViewport);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importInput, setImportInput] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [pasteInput, setPasteInput] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "save">("saved");
  const pendingActivePageRef = useRef<number | null>(null);
  const pendingSelectedIdsRef = useRef<string[] | null>(null);
  const lastSavedSigRef = useRef<string>("");
  const lastSavedLayoutSigRef = useRef<string>("");
  const lockedDisposeRef = useRef<(() => void) | null>(null);
  const canvasClipboardRef = useRef<CanvasItem[]>([]);
  // Keep latest pages in a ref so the unmount blob-URL cleanup can walk them
  // without being a dep of the mount effect. Assignment during render is safe —
  // it doesn't trigger renders.
  const pagesRef = useRef<BoardPage[]>([]);
  pagesRef.current = pages;
  const generationRef = useRef<GenerateResponse | null>(null);
  generationRef.current = generation;
  const boardOriginRef = useRef<BoardOrigin>({ kind: "draft" });
  boardOriginRef.current = boardOrigin;

  const restoreBoard = useCallback(
    (canvas: SharedCanvasData, origin: BoardOrigin = { kind: "draft" }) => {
      lockedDisposeRef.current?.();
      lockedDisposeRef.current = null;
      setPages(editorPagesFromCanvas(canvas));
      setGeneration(canvas.generation ?? null);
      setBoardOrigin(origin);
      setSelectedIds([]);
      navigate({ search: {}, replace: false });
    },
    [navigate],
  );

  const openImportDialog = useCallback(() => {
    setImportInput("");
    setImportDialogOpen(true);
  }, []);

  const openPasteDialog = useCallback(() => {
    setPasteInput("");
    setPasteDialogOpen(true);
  }, []);

  const newBoard = useCallback(() => {
    const empty = pagesRef.current.every(
      (p) => p.items.filter((i) => i.type !== "board_summary").length === 0,
    );
    if (empty) return;
    const prev = {
      pages: pagesRef.current,
      generation: generationRef.current,
      origin: boardOriginRef.current,
    };
    lockedDisposeRef.current?.();
    lockedDisposeRef.current = null;
    setPages([emptyBoardPage()]);
    setGeneration(null);
    setBoardOrigin({ kind: "draft" });
    setSelectedIds([]);
    void clearLocalDraft();
    notifyWithUndo("New board", () => {
      setPages(prev.pages);
      setGeneration(prev.generation);
      setBoardOrigin(prev.origin);
    });
  }, []);

  const importFromInput = useCallback(async () => {
    const raw = importInput.trim();
    if (!raw || isImporting) return;
    setIsImporting(true);
    try {
      const result = await importFromUrl(raw);
      if (!result.ok) {
        const messageByError: Record<typeof result.error, string> = {
          "invalid-input": "Paste a Shareboard link to import",
          "tiny-decode-failed": "Couldn't read that shared board",
          "fetch-failed": "Couldn't fetch that board (it may be on another host)",
          locked: "That board is locked. Open the link to view it.",
          unreadable: "That board is locked or not importable",
          "wrong-pin": "Wrong pin",
        };
        notify.error(messageByError[result.error]);
        return;
      }
      restoreBoard(result.canvas, { kind: "draft" });
      setImportDialogOpen(false);
      notify.success("Board imported");
    } finally {
      setIsImporting(false);
    }
  }, [importInput, isImporting, restoreBoard]);

  const {
    shareState,
    manualShareUrl,
    setManualShareUrl,
    lockedShareOpen,
    setLockedShareOpen,
    lockedShareBusy,
    history,
    openingEntryId,
    share,
    shareLocked,
    openHistoryEntry,
    removeHistoryEntry,
    markShareCopied,
  } = useShareFlows({
    pages,
    generation,
    boardOrigin,
    onRestoreBoard: restoreBoard,
    onOriginChange: setBoardOrigin,
  });

  const activePage = Math.max(0, Math.min(urlPage - 1, pages.length - 1));

  const setActivePage = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(next, pages.length - 1));
      navigate({
        search: clamped === 0 ? {} : { page: clamped + 1 },
        replace: false,
      });
    },
    [navigate, pages.length]
  );

  const hasApiKey = useSyncedSetting(() => !!getApiKey().trim());
  const itemsOnActive = pages[activePage]?.items ?? [];
  const totalContentItems = useMemo(
    () => pages.reduce((n, p) => n + p.items.filter((i) => i.type !== "board_summary").length, 0),
    [pages]
  );
  const totalMediaBytes = useMemo(
    () => mediaBytesForPages(pages),
    [pages]
  );
  const hasItems = totalContentItems > 0;

  useEffect(() => {
    if (pendingActivePageRef.current != null) return;
    setSelectedIds([]);
  }, [activePage]);

  useEffect(() => {
    const pendingPage = pendingActivePageRef.current;
    if (pendingPage != null) {
      const clamped = Math.max(0, Math.min(pendingPage, pages.length - 1));
      if (clamped !== activePage) {
        navigate({ search: clamped === 0 ? {} : { page: clamped + 1 }, replace: false });
        return;
      }
      pendingActivePageRef.current = null;
    }

    const pendingSelected = pendingSelectedIdsRef.current;
    if (pendingSelected !== null) {
      pendingSelectedIdsRef.current = null;
      setSelectedIds(pendingSelected);
    }
  }, [activePage, navigate, pages]);

  const currentDraftSig = useMemo(
    () => draftSignature(pages, generation, boardOrigin),
    [pages, generation, boardOrigin],
  );
  const currentDraftLayoutSig = useMemo(() => draftLayoutSignature(pages), [pages]);

  // Save current pages+generation+origin. Reads via refs so the callback identity is
  // stable across renders — important for the auto-save effect's deps.
  const writeDraft = useCallback(async (manual: boolean) => {
    const p = pagesRef.current;
    const g = generationRef.current;
    const o = boardOriginRef.current;
    const sig = draftSignature(p, g, o);
    const layoutSig = draftLayoutSignature(p);
    setSaveState("saving");
    try {
      await saveLocalDraft(p, g, o);
      lastSavedSigRef.current = sig;
      lastSavedLayoutSigRef.current = layoutSig;
      setSaveState("saved");
      if (manual) notify.success("Saved to this browser");
    } catch (error) {
      setSaveState("save");
      if (manual) {
        notify.error(error instanceof Error ? error.message : "Couldn't save locally");
      }
    }
  }, []);

  const handleSaveClick = useCallback(() => {
    void writeDraft(true);
  }, [writeDraft]);

  // Show the "Saved" word briefly after a save lands, then collapse to just
  // the check icon — keeps the notch quiet once everything is in sync.
  const [showSavedLabel, setShowSavedLabel] = useState(false);
  useEffect(() => {
    if (saveState === "saved") {
      setShowSavedLabel(true);
      const t = window.setTimeout(() => setShowSavedLabel(false), 1500);
      return () => window.clearTimeout(t);
    }
    setShowSavedLabel(false);
  }, [saveState]);

  // Auto-save with a short debounce. Content and layout signatures are tracked
  // separately so pure card moves persist without making rich editors noisy.
  useEffect(() => {
    if (!mounted) return;
    if (
      currentDraftSig === lastSavedSigRef.current &&
      currentDraftLayoutSig === lastSavedLayoutSigRef.current
    ) {
      setSaveState((prev) => (prev === "saved" ? prev : "saved"));
      return;
    }
    setSaveState((prev) => (prev === "save" ? prev : "save"));
    const timer = window.setTimeout(() => {
      void writeDraft(false);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [mounted, currentDraftSig, currentDraftLayoutSig, writeDraft]);

  // Mount-only: hydrate localStorage-backed flags + IDB draft, revoke blob URLs
  // on unmount. Mount paint is delayed until the draft load resolves so the
  // user doesn't see an empty-board flash before their saved work appears.
  useMountEffect(() => {
    setNeedsSetup(!isSetup());

    let cancelled = false;
    void loadLocalDraft()
      .then((draft) => {
        if (cancelled) return;
        if (draft) {
          setPages(draft.pages);
          setGeneration(draft.generation);
          setBoardOrigin(draft.boardOrigin);
          lastSavedSigRef.current = draftSignature(draft.pages, draft.generation, draft.boardOrigin);
          lastSavedLayoutSigRef.current = draftLayoutSignature(draft.pages);
        } else {
          lastSavedSigRef.current = draftSignature(pagesRef.current, null, { kind: "draft" });
          lastSavedLayoutSigRef.current = draftLayoutSignature(pagesRef.current);
        }
      })
      .finally(() => {
        if (!cancelled) setMounted(true);
      });

    return () => {
      cancelled = true;
      revokeDraftImagePreviews(pagesRef.current);
    };
  });

  /** Patch page at `index` with a partial update. */
  const patchPage = useCallback(
    (index: number, patch: Partial<BoardPage> | ((page: BoardPage) => BoardPage)) => {
      setPages((prev) =>
        prev.map((p, i) => {
          if (i !== index) return p;
          return typeof patch === "function" ? patch(p) : { ...p, ...patch };
        })
      );
    },
    []
  );

  const updateActivePageItems = useCallback(
    (
      mutate: (items: CanvasItem[], layouts: GridLayouts) => { items: CanvasItem[]; layouts: GridLayouts }
    ) => {
      patchPage(activePage, (page) => {
        const next = mutate(page.items, page.layouts);
        return { ...page, items: next.items, layouts: next.layouts };
      });
    },
    [patchPage, activePage]
  );

  /**
   * Add `item` to the active page, or spill to the next page (auto-creating it)
   * if the active page can't fit the new tile inside maxRows. Empty pages clamp
   * a single oversize tile to the page budget instead of creating unreachable
   * overflow.
   *
   * All state reads happen inside the setPages updater so rapid pastes (user
   * holding Cmd+V) see each other's work — otherwise they'd all compute
   * against the same pre-batch snapshot and later updaters would overwrite
   * earlier items.
   */
  const addItemWithSpill = useCallback(
    (item: CanvasItem) => {
      setPages((prev) => {
        const result = addItemWithSpillToPages({ pages: prev, activePage, item, maxRows });
        if (result.landedIndex !== activePage) pendingActivePageRef.current = result.landedIndex;
        return result.pages;
      });
    },
    [activePage, maxRows]
  );

  const addUrl = useCallback(
    async (rawUrl: string) => {
      if (!isValidUrl(rawUrl)) {
        notify.error("Enter a valid URL");
        return;
      }
      const platform = detectPlatform(rawUrl);
      const id = nanoid(10);
      const item: CanvasItem = { id, type: "url", url: rawUrl, platform };

      addItemWithSpill(item);

      // YouTube/Twitter render via dedicated embeds, so OG metadata is unused.
      // Other sites that block CF Workers (e.g. LinkedIn) gracefully fall back
      // to the icon + hostname card.
      if (platform === "youtube" || platform === "twitter") return;

      try {
        const res = await fetch(`/api/og?url=${encodeURIComponent(rawUrl)}`);
        if (res.ok) {
          const ogData = (await res.json()) as OGData;
          setPages((prev) =>
            prev.map((page) =>
              page.items.some((i) => i.id === id)
                ? {
                    ...page,
                    items: page.items.map((i) =>
                      i.id === id && i.type === "url" ? { ...i, ogData } : i
                    ),
                  }
                : page,
            )
          );
        }
      } catch {
        // OG fetch is best-effort; swallow errors so the item still renders.
      }
    },
    [addItemWithSpill]
  );

  const addImage = useCallback(
    async (file: File, caption?: string) => {
      let optimized;
      try {
        optimized = await optimizeImageForShare(file);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : "Could not add image");
        return false;
      }

      if (totalMediaBytes + optimized.file.size > IMAGE_POLICY.maxBoardBytes) {
        notify.error(`Boards can hold up to ${formatBytes(IMAGE_POLICY.maxBoardBytes)} of images`);
        return false;
      }

      const id = nanoid(10);
      const item: CanvasItem = {
        id,
        type: "image",
        file: optimized.file,
        previewUrl: URL.createObjectURL(optimized.file),
        mimeType: optimized.file.type || undefined,
        size: optimized.file.size,
        caption,
        aspect: optimized.aspect,
      };
      addItemWithSpill(item);
      const saved = optimized.originalSize - optimized.file.size;
      notify.success(saved > 512 * 1024 ? `Image optimized to ${formatBytes(optimized.file.size)}` : "Image added");
      return true;
    },
    [addItemWithSpill, totalMediaBytes]
  );

  const addImages = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return false;

      const optimizedImages = [];
      const seen = new Set<string>();
      let duplicateCount = 0;
      for (const file of imageFiles) {
        try {
          const optimized = await optimizeImageForShare(file);
          const fingerprint = await fileFingerprint(optimized.file);
          if (seen.has(fingerprint)) {
            duplicateCount += 1;
            continue;
          }
          seen.add(fingerprint);
          optimizedImages.push(optimized);
        } catch (error) {
          notify.error(error instanceof Error ? error.message : "Could not add image");
        }
      }

      let mediaBytes = mediaBytesForPages(pagesRef.current);
      const items: CanvasItem[] = [];
      for (const optimized of optimizedImages) {
        if (mediaBytes + optimized.file.size > IMAGE_POLICY.maxBoardBytes) {
          notify.error(`Boards can hold up to ${formatBytes(IMAGE_POLICY.maxBoardBytes)} of images`);
          break;
        }
        mediaBytes += optimized.file.size;
        items.push({
          id: nanoid(10),
          type: "image",
          file: optimized.file,
          previewUrl: URL.createObjectURL(optimized.file),
          mimeType: optimized.file.type || undefined,
          size: optimized.file.size,
          aspect: optimized.aspect,
        });
      }

      if (items.length === 0) return false;

      setPages((prev) => {
        let nextPages = prev;
        let landingPage = activePage;
        let lastLandedIndex = activePage;
        const idsByPage = new Map<number, string[]>();
        for (const item of items) {
          const result = addItemWithSpillToPages({
            pages: nextPages,
            activePage: landingPage,
            item,
            maxRows,
          });
          nextPages = result.pages;
          landingPage = result.landedIndex;
          lastLandedIndex = result.landedIndex;
          idsByPage.set(result.landedIndex, [...(idsByPage.get(result.landedIndex) ?? []), item.id]);
        }
        pendingSelectedIdsRef.current = idsByPage.get(lastLandedIndex) ?? [];
        if (lastLandedIndex !== activePage) pendingActivePageRef.current = lastLandedIndex;
        return nextPages;
      });
      notify.success(
        duplicateCount > 0
          ? `${items.length} unique ${items.length === 1 ? "image" : "images"} added, ${duplicateCount} duplicate ${duplicateCount === 1 ? "entry" : "entries"} skipped`
          : items.length === 1
            ? "Image added"
            : `${items.length} images added`,
      );
      return true;
    },
    [activePage, maxRows],
  );

  const addNote = useCallback(
    (text: string) => {
      const id = nanoid(10);
      const item: CanvasItem = { id, type: "note" as const, text };
      addItemWithSpill(item);
    },
    [addItemWithSpill]
  );

  const submitPasteDialog = useCallback(() => {
    const value = pasteInput.trim();
    if (!value) return;
    if (isValidUrl(value)) void addUrl(value);
    else addNote(value);
    setPasteDialogOpen(false);
    setPasteInput("");
  }, [pasteInput, addUrl, addNote]);

  const removeItems = useCallback(
    (pageIndex: number, ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const currentPageId = pagesRef.current[activePage]?.id;
      const removed = pagesRef.current.map((page, index) =>
        index === pageIndex ? removeItemsFromPage(page, idSet) : page,
      );
      const compacted = pruneEmptyPages(removed);
      const currentIndex = currentPageId ? compacted.findIndex((page) => page.id === currentPageId) : -1;
      const nextActivePage = currentIndex >= 0 ? currentIndex : Math.min(pageIndex, compacted.length - 1);
      setPages(compacted);
      if (nextActivePage !== activePage) {
        queueMicrotask(() => navigate({ search: nextActivePage === 0 ? {} : { page: nextActivePage + 1 }, replace: false }));
      }
      if (idSet.has(BOARD_SUMMARY_ITEM_ID)) setGeneration(null);
      setGeneration((g) =>
        g
          ? { ...g, item_summaries: g.item_summaries.filter((s) => !idSet.has(s.item_id)) }
          : g
      );
      setSelectedIds((prev) => prev.filter((x) => !idSet.has(x)));
    },
    [activePage, navigate]
  );

  const removeItem = useCallback(
    (pageIndex: number, id: string) => {
      removeItems(pageIndex, [id]);
    },
    [removeItems]
  );

  const duplicateItem = useCallback(
    (pageIndex: number, id: string) => {
      if (id === BOARD_SUMMARY_ITEM_ID) return;
      const source = pagesRef.current[pageIndex]?.items.find((item) => item.id === id);
      if (source?.type === "image" && mediaBytesForPages(pagesRef.current) + (source.size ?? 0) > IMAGE_POLICY.maxBoardBytes) {
        notify.error(`Boards can hold up to ${formatBytes(IMAGE_POLICY.maxBoardBytes)} of images`);
        return;
      }
      setPages((prev) => {
        const result = duplicateItemWithSpillToPages({
          pages: prev,
          activePage: pageIndex,
          id,
          maxRows,
        });
        if (!result) return prev;
        pendingSelectedIdsRef.current = [result.newId];
        if (result.landedIndex !== pageIndex) pendingActivePageRef.current = result.landedIndex;
        return result.pages;
      });
    },
    [maxRows]
  );

  const pasteCanvasItems = useCallback(
    (items: CanvasItem[]) => {
      const copies = items.map(cloneCanvasItem).filter((item): item is CanvasItem => !!item);
      if (copies.length === 0) return false;
      if (mediaBytesForPages(pagesRef.current) + mediaBytesForItems(copies) > IMAGE_POLICY.maxBoardBytes) {
        revokeImagePreviews(copies);
        notify.error(`Boards can hold up to ${formatBytes(IMAGE_POLICY.maxBoardBytes)} of images`);
        return false;
      }

      setPages((prev) => {
        let nextPages = prev;
        let landingPage = activePage;
        let lastLandedIndex = activePage;
        const idsByPage = new Map<number, string[]>();
        for (const item of copies) {
          const result = addItemWithSpillToPages({
            pages: nextPages,
            activePage: landingPage,
            item,
            maxRows,
          });
          nextPages = result.pages;
          landingPage = result.landedIndex;
          lastLandedIndex = result.landedIndex;
          idsByPage.set(result.landedIndex, [...(idsByPage.get(result.landedIndex) ?? []), item.id]);
        }
        pendingSelectedIdsRef.current = idsByPage.get(lastLandedIndex) ?? [];
        if (lastLandedIndex !== activePage) pendingActivePageRef.current = lastLandedIndex;
        return nextPages;
      });
      return true;
    },
    [activePage, maxRows],
  );

  const updateNoteText = useCallback(
    (pageIndex: number, id: string, text: string) => {
      patchPage(pageIndex, (page) => ({
        ...page,
        items: page.items.map((i) => (i.id === id && i.type === "note" ? { ...i, text } : i)),
      }));
    },
    [patchPage]
  );

  const generate = useCallback(async () => {
    if (!getApiKey().trim()) {
      notify.error("Add an OpenAI API key in settings to summarize");
      return;
    }
    const allItems = pages.flatMap((p) => p.items.filter((i) => i.type !== "board_summary"));
    if (allItems.length === 0) return;
    setIsGenerating(true);
    const progress = notifyProgress("Summarizing");
    try {
      const generationItems = allItems.map((item) =>
        item.type === "image"
          ? { id: item.id, type: "image" as const, caption: item.caption }
          : item
      );
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": getApiKey() },
        body: JSON.stringify({ items: generationItems }),
      });
      if (!res.ok) {
        progress.error(await readErrorMessage(res, "Generation failed"));
        return;
      }
      const data = sanitizeGeneration((await res.json().catch(() => null)) as unknown);
      if (!data) {
        progress.error("Generation failed");
        return;
      }
      setGeneration(data);
      patchPage(0, (page) => {
        if (page.items.some((i) => i.id === BOARD_SUMMARY_ITEM_ID)) return page;
        const nextItems: CanvasItem[] = [
          ...page.items,
          { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" },
        ];
        const nextLayouts = packPageLayouts(nextItems, page.layouts, maxRows);
        return { ...page, items: nextItems, layouts: nextLayouts };
      });
      setActivePage(0);
      progress.success("Summary ready");
    } catch {
      progress.error("Failed to connect");
    } finally {
      setIsGenerating(false);
    }
  }, [pages, patchPage, maxRows, setActivePage]);

  const handleDropData = useCallback(
    (data: DataTransfer) => {
      if (needsSetup) return;

      const files = Array.from(data.files);
      const imageFiles = imageFilesFromTransfer(data);
      if (imageFiles.length > 0) {
        void addImages(imageFiles);
        return;
      }

      if (files.length > 0) {
        notify.error("Only images can be dropped into a board");
        return;
      }

      const html = data.getData("text/html")?.trim() || null;
      const text = data.getData("text/plain")?.trim() || null;
      const svgSource = findSvgSource(html, text);
      if (svgSource) {
        void addImage(createSvgFile(svgSource));
        return;
      }

      const url = findSharedUrl(data.types, (type) => data.getData(type));
      if (url) {
        void addUrl(url);
        notify.success("URL added");
        return;
      }

      if (text) {
        addNote(text);
        notify.success("Note added");
      }
    },
    [needsSetup, addImage, addImages, addNote, addUrl]
  );

  // Install the paste listener once on mount and route through a latest-handler
  // ref so closure deps (addUrl, addImage, addNote, needsSetup) stay current
  // without resubscribing — resubscribing on rapid pastes dropped items.
  const handlePasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  handlePasteRef.current = (e: ClipboardEvent) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (
      target?.closest("input, textarea, select") ||
      target?.isContentEditable ||
      target?.closest(".tiptap") ||
      target?.closest("[contenteditable]")
    ) {
      return;
    }

    if (needsSetup) return;

    const clipboard = e.clipboardData;
    if (!clipboard) return;

    if (clipboard.files.length > 0) {
      e.preventDefault();
      const imageFiles = imageFilesFromTransfer(clipboard);
      if (imageFiles.length > 0) {
        void addImages(imageFiles);
      } else {
        notify.error("Only images can be pasted into a board");
      }
      return;
    }

    const imageFilesFromItems = imageFilesFromTransfer(clipboard);
    if (imageFilesFromItems.length > 0) {
      e.preventDefault();
      void addImages(imageFilesFromItems);
      return;
    }

    const html = clipboard.getData("text/html")?.trim() || null;
    const text = clipboard.getData("text/plain")?.trim() || null;
    const svgSource = findSvgSource(html, text);
    if (svgSource) {
      e.preventDefault();
      void addImage(createSvgFile(svgSource));
      return;
    }

    const url = findSharedUrl(clipboard.types, (type) => clipboard.getData(type));
    if (url) {
      e.preventDefault();
      void addUrl(url);
      notify.success("URL added");
      return;
    }

    if (!text) return;
    if (looksLikeImageFilename(text)) {
      e.preventDefault();
      notify.error("Paste the image data or drop the file onto the board");
      return;
    }
    e.preventDefault();
    addNote(text);
    notify.success("Note added");
  };

  const handleCanvasSelect = useCallback((id: string | null, e?: SelectionEvent) => {
    if (id === null) {
      setSelectedIds([]);
      return;
    }
    if (e?.metaKey || e?.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return [...next];
      });
    } else {
      setSelectedIds([id]);
    }
  }, []);

  const handleCanvasSelectMany = useCallback((ids: string[], additive: boolean) => {
    setSelectedIds((prev) => {
      if (!additive) return ids;
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return [...next];
    });
  }, []);

  // Same latest-handler ref pattern for keydown shortcuts.
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const inField =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      !!target.closest('[contenteditable="true"]');

    if (deleteDialogIds) return;
    if (inField) return;

    if (target.closest("[data-slot=dialog-content]") || target.closest("[data-slot=dialog-overlay]")) {
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      if (!needsSetup && itemsOnActive.length > 0) {
        setSelectedIds(itemsOnActive.map((i) => i.id));
      }
      return;
    }

    if (!needsSetup) {
      if (e.key === "ArrowLeft" && activePage > 0) {
        e.preventDefault();
        setActivePage(activePage - 1);
        return;
      }
      if (e.key === "ArrowRight" && activePage < pages.length - 1) {
        e.preventDefault();
        setActivePage(activePage + 1);
        return;
      }
    }

    if (needsSetup) return;

    const key = e.key.toLowerCase();

    if ((e.metaKey || e.ctrlKey) && key === "v") {
      if (canvasClipboardRef.current.length === 0) return;
      e.preventDefault();
      if (pasteCanvasItems(canvasClipboardRef.current)) notify.success("Pasted");
      return;
    }

    if (selectedIds.length === 0) return;

    if ((e.metaKey || e.ctrlKey) && key === "c") {
      e.preventDefault();
      const selected = itemsOnActive.filter(
        (item) => selectedIds.includes(item.id) && item.type !== "board_summary",
      );
      canvasClipboardRef.current = selected;
      if (selected.length > 0) {
        notify.success(selected.length > 1 ? "Copied items" : "Copied item");
      }
      return;
    }

    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (selectedIds.length > 1) {
        setDeleteDialogIds([...selectedIds]);
        return;
      }
      const only = selectedIds[0]!;
      const selected = itemsOnActive.find((i) => i.id === only);
      if (selected) removeItem(activePage, only);
      return;
    }

    if (selectedIds.length > 1) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedIds([]);
      }
      return;
    }

    const one = selectedIds[0]!;
    const selected = itemsOnActive.find((i) => i.id === one);
    if (!selected) return;

    if ((e.metaKey || e.ctrlKey) && key === "d") {
      e.preventDefault();
      duplicateItem(activePage, one);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setSelectedIds([]);
    }
  };

  // Install document-level paste and keydown listeners exactly once. Each
  // delegates to its *Ref handler so closure state stays fresh without
  // resubscribing (see rapid-paste bug fix).
  useMountEffect(() => {
    const onPaste = (e: ClipboardEvent) => handlePasteRef.current(e);
    const onKeyDown = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  });

  if (!mounted) return null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="board-notch" data-locked={needsSetup || undefined}>
        {hasItems && (
          <>
            <button
              type="button"
              className="board-notch-action"
              onClick={handleSaveClick}
              disabled={saveState === "saving"}
              aria-label="Save board to this browser"
              title="Save board to this browser"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={saveState}
                  className="board-notch-action-content"
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  {saveState === "saving" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : saveState === "saved" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <AnimatePresence initial={false}>
                    {saveState !== "saved" || showSavedLabel ? (
                      <motion.span
                        key="label"
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto" }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        style={{ display: "inline-block", overflow: "hidden", whiteSpace: "nowrap" }}
                      >
                        {saveState === "saving"
                          ? "Saving"
                          : saveState === "saved"
                          ? "Saved"
                          : "Save"}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </motion.span>
              </AnimatePresence>
            </button>
            <span aria-hidden className="board-notch-divider" />
          </>
        )}
        <button
          type="button"
          className="board-notch-action"
          onClick={share}
          disabled={!hasItems || shareState === "sharing"}
          aria-label="Share board"
          title="Share board"
        >
          {shareState === "sharing" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : shareState === "copied" ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Share2 className="h-3.5 w-3.5" />
          )}
          <span>{shareState === "copied" ? "Copied" : "Share"}</span>
        </button>
      </div>

      <BoardCarousel
        pages={pages}
        activeIndex={activePage}
        getPageKey={(page) => page.id}
        onNavigate={(delta) => setActivePage(activePage + delta)}
        renderPage={(page, i, isActive) => (
          <Canvas
            items={page.items}
            generation={generation}
            layouts={page.layouts}
            maxRows={maxRows}
            selectedIds={isActive ? selectedIds : undefined}
            onSelect={isActive ? handleCanvasSelect : undefined}
            onSelectMany={isActive ? handleCanvasSelectMany : undefined}
            onLayoutChange={(next) => patchPage(i, { layouts: next })}
            onRemove={(id) => removeItem(i, id)}
            onDropData={isActive ? handleDropData : undefined}
            onUpdateNoteText={(id, text) => updateNoteText(i, id, text)}
            onMaxRowsChange={isActive ? setMaxRows : undefined}
            acceptExternalDrop={isActive && !needsSetup}
            hideEmptyState={needsSetup}
          />
        )}
      />

      <Toolbar
        hasItems={hasItems}
        hasApiKey={hasApiKey}
        isGenerating={isGenerating}
        locked={needsSetup}
        pageCount={pages.length}
        activePage={activePage}
        history={history}
        openingEntryId={openingEntryId}
        onChangePage={setActivePage}
        onAddImage={(file) => void addImage(file)}
        onPasteLink={openPasteDialog}
        onImport={openImportDialog}
        onGenerate={generate}
        onShare={() => setLockedShareOpen(true)}
        onNewBoard={newBoard}
        onOpenHistoryEntry={openHistoryEntry}
        onRemoveHistoryEntry={removeHistoryEntry}
      />

      {needsSetup && <SetupCards onComplete={() => setNeedsSetup(false)} />}

      <LockedShareDialog
        open={lockedShareOpen}
        busy={lockedShareBusy}
        onOpenChange={setLockedShareOpen}
        onCreate={shareLocked}
      />

      <Dialog
        open={deleteDialogIds !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogIds(null);
        }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>
              Remove {deleteDialogIds?.length ?? 0} item
              {deleteDialogIds && deleteDialogIds.length !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription className="text-pretty">
              These cards will be removed from this page. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogIds(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleteDialogIds) removeItems(activePage, deleteDialogIds);
                setDeleteDialogIds(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (!open && isImporting) return;
          setImportDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Import a shared board</DialogTitle>
            <DialogDescription>
              Paste a Shareboard link to load it onto your canvas. This replaces the current board — share or save it first if you want to keep it.
            </DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            placeholder="https://..."
            value={importInput}
            onChange={(e) => setImportInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && importInput.trim() && !isImporting) {
                e.preventDefault();
                void importFromInput();
              }
            }}
            className="setup-dialog-tile-input"
          />
          <DialogFooter className="mt-2">
            <DialogClose render={<Button type="button" variant="outline" disabled={isImporting} />}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              onClick={() => void importFromInput()}
              disabled={!importInput.trim() || isImporting}
            >
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pasteDialogOpen} onOpenChange={setPasteDialogOpen}>
        <DialogContent className="paste-dialog sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Add link or note</DialogTitle>
            <DialogDescription>
              Paste a URL or write a note.
            </DialogDescription>
          </DialogHeader>
          <textarea
            autoFocus
            placeholder="https://... or type a note"
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && pasteInput.trim()) {
                e.preventDefault();
                submitPasteDialog();
              }
            }}
            rows={4}
            className="paste-dialog-input"
          />
          <DialogFooter className="paste-dialog-footer">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="button" onClick={submitPasteDialog} disabled={!pasteInput.trim()}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!manualShareUrl}
        onOpenChange={(open) => {
          if (!open) setManualShareUrl("");
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Share link</DialogTitle>
            <DialogDescription>
              Your board was created, but the browser blocked automatic clipboard access.
            </DialogDescription>
          </DialogHeader>
          <input
            readOnly
            value={manualShareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="setup-dialog-tile-input"
          />
          <DialogFooter className="mt-2">
            <DialogClose render={<Button type="button" variant="outline" />}>Done</DialogClose>
            <Button
              type="button"
              onClick={async () => {
                if (await copyText(manualShareUrl)) {
                  setManualShareUrl("");
                  markShareCopied();
                  notify.success("Link copied to clipboard");
                } else {
                  notify.error("Select the link to copy it");
                }
              }}
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toasts slide up from bottom-right. When the page-nav pill is present
          (>1 page), we shift left past it so the two don't collide. */}
      <Toaster
        position="bottom-right"
        offset={{ bottom: "1.25rem", right: pages.length > 1 ? "12rem" : "1.25rem" }}
        mobileOffset={{ bottom: "1.25rem", right: pages.length > 1 ? "10rem" : "1rem" }}
      />
    </div>
  );
}
