import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { isPlausibleOpenaiApiKey, sanitizeOpenaiApiKeyInput } from "@/lib/openai-api-key";
import { setApiKey, setName, setProfile, getName, getApiKey, getProfile } from "@/lib/store";
import { useIsMobile } from "@/lib/use-is-mobile";
import {
  Check,
  Clock3,
  ImagePlus,
  Sparkles,
  LockKeyhole,
  Settings,
  Loader2,
  Trash2,
  Plus,
  Download,
  Copy,
  Pencil,
  FilePlus,
  ClipboardPaste,
} from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { notify } from "@/lib/toast";
import { X as XIcon } from "@/components/ui/svgs/x";
import { InstagramIcon } from "@/components/ui/svgs/instagramIcon";
import { Linkedin } from "@/components/ui/svgs/linkedin";
import { PageNav } from "@/components/page-nav";
import { ActionFan, type ActionFanItem } from "@/components/action-fan";
import type { BoardHistoryEntry } from "@/lib/store";

export function Toolbar({
  hasItems,
  hasApiKey,
  isGenerating,
  locked,
  pageCount,
  activePage,
  history,
  openingEntryId,
  onChangePage,
  onAddImage,
  onPasteLink,
  onImport,
  onGenerate,
  onShare,
  onNewBoard,
  onOpenHistoryEntry,
  onRemoveHistoryEntry,
}: {
  hasItems: boolean;
  hasApiKey: boolean;
  isGenerating: boolean;
  locked?: boolean;
  pageCount: number;
  activePage: number;
  history: BoardHistoryEntry[];
  openingEntryId: string | null;
  onChangePage: (next: number) => void;
  onAddImage: (file: File) => void;
  onPasteLink: () => void;
  onImport: () => void;
  onGenerate: () => void;
  onShare: () => void;
  onNewBoard: () => void;
  onOpenHistoryEntry: (entry: BoardHistoryEntry) => void;
  onRemoveHistoryEntry: (entry: BoardHistoryEntry) => void;
}) {
  const isMobile = useIsMobile();
  // Single source of truth for which toolbar menu (if any) is open. base-ui's
  // Popover dropped second-click toggles via stickIfOpen + PATIENT_CLICK_THRESHOLD;
  // we mirror ActionFan's pattern instead. The document-level mousedown listener
  // closes any open menu when clicking elsewhere — including another trigger —
  // so opening one naturally closes the previous one.
  //
  // Toggle uses a functional setter so two synchronous clicks chain
  // (null → "settings" → null) instead of both reading the stale snapshot.
  // openMenu shape: "settings" | "history" | null
  const [openMenu, setOpenMenu] = useState<"settings" | "history" | null>(null);
  const settingsOpen = openMenu === "settings";
  const historyOpen = openMenu === "history";
  const toggleMenu = (id: "settings" | "history") =>
    setOpenMenu((prev) => (prev === id ? null : id));
  const closeMenu = () => setOpenMenu(null);

  const [settingsName, setSettingsName] = useState("");
  const [settingsKey, setSettingsKey] = useState("");
  const [settingsX, setSettingsX] = useState("");
  const [settingsIg, setSettingsIg] = useState("");
  const [settingsLi, setSettingsLi] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onAddImage(file);
    e.target.value = "";
  };

  const fanItems: ActionFanItem[] = [
    {
      label: "Paste link or note",
      icon: <ClipboardPaste className="h-4 w-4" />,
      onClick: onPasteLink,
    },
    {
      label: "Upload image",
      icon: <ImagePlus className="h-4 w-4" />,
      onClick: () => fileRef.current?.click(),
    },
    {
      label: "Import shared board",
      icon: <Download className="h-4 w-4" />,
      onClick: onImport,
    },
    // Summarize is hidden until the board has content — there's nothing to
    // summarize otherwise, and the disabled-button shape was just noise.
    ...(hasItems
      ? [{
          label: hasApiKey ? "Summarize board" : "Summarize board (add an OpenAI key first)",
          icon: isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          ),
          onClick: onGenerate,
          disabled: isGenerating || !hasApiKey,
        } satisfies ActionFanItem]
      : []),
    {
      label: "Locked share",
      icon: <LockKeyhole className="h-4 w-4" />,
      onClick: onShare,
      disabled: !hasItems,
    },
  ];

  const hydrateSettingsFields = () => {
    setSettingsName(getName());
    setSettingsKey(sanitizeOpenaiApiKeyInput(getApiKey()));
    const p = getProfile();
    setSettingsX(p.xUrl ?? "");
    setSettingsIg(p.instagramUrl ?? "");
    setSettingsLi(p.linkedinUrl ?? "");
  };

  // Re-hydrate settings inputs whenever the menu opens. hydrateSettingsFields
  // reads freshest store values on each call, so the stable identity isn't
  // important here.
  useEffect(() => {
    if (settingsOpen) hydrateSettingsFields();
  }, [settingsOpen]);

  const saveSettings = () => {
    if (settingsName.trim()) setName(settingsName.trim());
    setApiKey(settingsKey);
    setProfile({
      xUrl: settingsX.trim(),
      instagramUrl: settingsIg.trim(),
      linkedinUrl: settingsLi.trim(),
    });
    closeMenu();
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      <div
        className="board-toolbar"
        data-locked={locked || undefined}
        inert={locked || undefined}
        aria-hidden={locked || undefined}
      >
        {/* Left: settings */}
        <div className="board-toolbar-left">
          <ToolbarMenu
            open={settingsOpen}
            onToggle={() => toggleMenu("settings")}
            onClose={closeMenu}
            ariaLabel="Settings"
            popupClassName="board-popover board-popover--settings"
            triggerIcon={<Settings className="h-4 w-4 text-foreground/60" />}
          >
              <div className="setup-dialog-tile">
                <span className="setup-dialog-tile-label">Display name</span>
                <input
                  placeholder="Your name"
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  className="setup-dialog-tile-input"
                />
              </div>

            <div className="setup-dialog-tile">
              <span className="setup-dialog-tile-label">
                Social links
                <span className="setup-dialog-tile-label-muted">(optional)</span>
              </span>
              <div className="setup-dialog-social-list">
                <div className="setup-dialog-social-item">
                  <XIcon
                    className="h-4 w-4 shrink-0 [&_path]:fill-current text-foreground/70"
                    aria-hidden
                  />
                  <input
                    placeholder="https://x.com/username"
                    value={settingsX}
                    onChange={(e) => setSettingsX(e.target.value)}
                    className="setup-dialog-tile-input"
                  />
                </div>
                <div className="setup-dialog-social-item">
                  <InstagramIcon className="h-4 w-4 shrink-0" aria-hidden />
                  <input
                    placeholder="https://instagram.com/username"
                    value={settingsIg}
                    onChange={(e) => setSettingsIg(e.target.value)}
                    className="setup-dialog-tile-input"
                  />
                </div>
                <div className="setup-dialog-social-item">
                  <Linkedin className="h-4 w-4 shrink-0" aria-hidden />
                  <input
                    placeholder="https://linkedin.com/in/username"
                    value={settingsLi}
                    onChange={(e) => setSettingsLi(e.target.value)}
                    className="setup-dialog-tile-input"
                  />
                </div>
              </div>
            </div>

            <div className="setup-dialog-tile">
              <span className="setup-dialog-tile-label">
                OpenAI API key
                <span className="setup-dialog-tile-label-muted">(optional, for Summarize)</span>
              </span>
              <div className="setup-dialog-apikey-row">
                <input
                  type="text"
                  placeholder="sk-..."
                  value={settingsKey}
                  onChange={(e) => setSettingsKey(sanitizeOpenaiApiKeyInput(e.target.value))}
                  autoComplete="off"
                  className="setup-dialog-tile-input setup-dialog-tile-input--masked"
                />
                {isPlausibleOpenaiApiKey(settingsKey) && (
                  <span
                    className="setup-dialog-apikey-ok"
                    title="Key format looks good"
                    aria-label="Key format looks good"
                  >
                    <Check strokeWidth={2.5} aria-hidden />
                  </span>
                )}
              </div>
            </div>

            <Button
              onClick={saveSettings}
              className="h-11 w-full rounded-full text-[14px] font-medium bg-foreground hover:bg-foreground/90 text-background"
            >
              Save
            </Button>
          </ToolbarMenu>

          <ToolbarMenu
            open={historyOpen}
            onToggle={() => toggleMenu("history")}
            onClose={closeMenu}
            ariaLabel="Recent boards"
            popupClassName={`board-popover board-popover--history${
              history.length === 0 ? " board-popover--history-empty" : ""
            }`}
            triggerIcon={<Clock3 className="h-4 w-4 text-foreground/60" />}
          >
            <div className="board-popover-section board-history">
              <button
                type="button"
                className="board-history-row board-history-new"
                disabled={!hasItems}
                onClick={() => {
                  onNewBoard();
                  closeMenu();
                }}
              >
                <FilePlus className="h-4 w-4 text-foreground/60" aria-hidden />
                <span className="board-history-title">New board</span>
              </button>
              {history.length === 0 ? (
                <div className="board-history-empty">Recent boards appear here.</div>
              ) : (
                history.map((entry) => {
                  const canEdit = entry.kind === "tiny" || !!entry.deleteToken;
                  const isOpening = openingEntryId === entry.id;
                  const removeTooltip = entry.deleteToken
                    ? "Delete share"
                    : "Remove from history (live link unaffected)";
                  return (
                    <div className="board-history-row" key={entry.id}>
                      <button
                        type="button"
                        className="board-history-main"
                        onClick={() => {
                          if (canEdit) {
                            void onOpenHistoryEntry(entry);
                            closeMenu();
                          } else {
                            window.open(entry.shareUrl, "_blank", "noopener,noreferrer");
                          }
                        }}
                      >
                        <span className="board-history-title">{entry.title}</span>
                        <span className="board-history-subtitle">{entry.subtitle}</span>
                      </button>
                      <div className="board-history-actions">
                        <button
                          type="button"
                          className="board-history-action"
                          aria-label={`Copy link to ${entry.title}`}
                          title="Copy link"
                          onClick={async () => {
                            const ok = await copyText(entry.shareUrl);
                            if (ok) notify.success("Link copied to clipboard");
                            else notify.error("Couldn't copy link");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {canEdit ? (
                          <button
                            type="button"
                            className="board-history-action"
                            aria-label={`Edit ${entry.title}`}
                            title="Edit"
                            disabled={isOpening}
                            onClick={() => {
                              void onOpenHistoryEntry(entry);
                              closeMenu();
                            }}
                          >
                            {isOpening ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" />
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="board-history-action"
                            disabled
                            title="Re-share to enable in-place editing"
                            aria-label="Editing unavailable for this entry"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="board-history-action"
                          aria-label={`${removeTooltip} for ${entry.title}`}
                          title={removeTooltip}
                          onClick={() => void onRemoveHistoryEntry(entry)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ToolbarMenu>
        </div>

        {/* Center: Plus button (pill) with radial fan menu */}
        <div className="board-toolbar-center">
          <ActionFan
            triggerClassName="board-toolbar-add"
            trigger={<Plus className="h-5 w-5" strokeWidth={2.25} />}
            items={fanItems}
            radius={isMobile ? 124 : 96}
          />
        </div>

        {/* Right: segmented nav pill */}
        <div className="board-toolbar-right">
          <PageNav
            pageCount={pageCount}
            activeIndex={activePage}
            onChange={onChangePage}
          />
        </div>
      </div>
    </>
  );
}

// Plain anchored menu: trigger calls onToggle (parent uses functional setter),
// document mousedown calls onClose. Mirrors ActionFan so behavior matches the
// plus button.
function ToolbarMenu({
  open,
  onToggle,
  onClose,
  ariaLabel,
  triggerIcon,
  popupClassName,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  ariaLabel: string;
  triggerIcon: ReactNode;
  popupClassName: string;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapperRef} className="board-toolbar-menu">
      <button
        type="button"
        className="board-toolbar-icon"
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        {triggerIcon}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            key="popup"
            className={`board-toolbar-menu-popup ${popupClassName}`}
            // Open uses ActionFan's spring for the bouncy pop-in. Close uses
            // a snappy tween — springs feel sluggish for dismissals because
            // they ease out instead of cutting.
            initial={{ opacity: 0, y: 8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: 4,
              scale: 0.96,
              transition: { duration: 0.1, ease: "easeOut" },
            }}
            transition={{ type: "spring", stiffness: 320, damping: 26, mass: 0.8 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
