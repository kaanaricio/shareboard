import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { isLockedCanvasStub, type StoredCanvas } from "@/lib/types";
import { SharedCanvas } from "@/components/shared-canvas";
import { LockedCanvas } from "@/components/locked-canvas";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; canvas: StoredCanvas }
  | { status: "error" };

type SharedSearch = { page?: number };

export const Route = createFileRoute("/c/$id")({
  validateSearch: (search): SharedSearch => {
    const raw = Number(search.page);
    if (!Number.isFinite(raw) || raw < 1) return {};
    return { page: Math.floor(raw) };
  },
  head: () => ({
    meta: [
      { title: "Shareboard" },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: "Shareboard" },
    ],
  }),
  component: SharedPage,
  notFoundComponent: () => (
    <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
      Board not found.
    </div>
  ),
});

function SharedPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState({ status: "loading" });
      try {
        const res = await fetch(`/api/share?key=${encodeURIComponent(`canvases/${id}.json`)}`);
        if (!res.ok) throw new Error("Board not found");
        const canvas = (await res.json()) as StoredCanvas;
        if (!cancelled) setState({ status: "ready", canvas });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === "loading") {
    return <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Loading board...</div>;
  }
  if (state.status === "error") {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Board not found.
      </div>
    );
  }
  const { canvas } = state;
  if (isLockedCanvasStub(canvas)) {
    return <LockedCanvas id={canvas.id} initialPageIndex={(search.page ?? 1) - 1} />;
  }
  return <SharedCanvas canvas={canvas} initialPageIndex={(search.page ?? 1) - 1} />;
}
