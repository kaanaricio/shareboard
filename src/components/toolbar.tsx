import { useState, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { isPlausibleOpenaiApiKey, sanitizeOpenaiApiKeyInput } from "@/lib/openai-api-key";
import { setApiKey, setName, setProfile, getName, getApiKey, getProfile } from "@/lib/store";
import {
  Check,
  Clock3,
  ImagePlus,
  Type,
  Sparkles,
  Share2,
  Settings,
  Loader2,
  Trash2,
  Plus,
  Layers,
} from "lucide-react";
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
  isDeletingShare,
  hasLastSharedBoard,
  locked,
  pageCount,
  activePage,
  history,
  onChangePage,
  onAddPage,
  onAddImage,
  onAddNote,
  onGenerate,
  onShare,
  onDeleteLastShare,
  onOpenHistoryEntry,
  onRemoveHistoryEntry,
}: {
  hasItems: boolean;
  hasApiKey: boolean;
  isGenerating: boolean;
  isDeletingShare: boolean;
  hasLastSharedBoard: boolean;
  locked?: boolean;
  pageCount: number;
  activePage: number;
  history: BoardHistoryEntry[];
  onChangePage: (next: number) => void;
  onAddPage: () => void;
  onAddImage: (file: File) => void | Promise<boolean>;
  onAddNote: (text: string) => void;
  onGenerate: () => void;
  onShare: () => void;
  onDeleteLastShare: () => void;
  onOpenHistoryEntry: (entry: BoardHistoryEntry) => void;
  onRemoveHistoryEntry: (id: string) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
      label: "Text note",
      icon: <Type className="h-4 w-4" />,
      onClick: () => onAddNote(""),
    },
    {
      label: "Upload image",
      icon: <ImagePlus className="h-4 w-4" />,
      onClick: () => fileRef.current?.click(),
    },
    {
      label: "New page",
      icon: <Layers className="h-4 w-4" />,
      onClick: onAddPage,
    },
    {
      label: !hasApiKey
        ? "Summarize board (add an OpenAI key first)"
        : !hasItems
        ? "Summarize board (add an item first)"
        : "Summarize board",
      icon: isGenerating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      ),
      onClick: onGenerate,
      disabled: isGenerating || !hasApiKey || !hasItems,
    },
    {
      label: "Share board",
      icon: <Share2 className="h-4 w-4" />,
      onClick: onShare,
      disabled: !hasItems,
    },
  ];

  const handleSettingsOpenChange = (next: boolean) => {
    if (next) {
      setSettingsName(getName());
      setSettingsKey(sanitizeOpenaiApiKeyInput(getApiKey()));
      const p = getProfile();
      setSettingsX(p.xUrl ?? "");
      setSettingsIg(p.instagramUrl ?? "");
      setSettingsLi(p.linkedinUrl ?? "");
    }
    setSettingsOpen(next);
  };

  const saveSettings = () => {
    if (settingsName.trim()) setName(settingsName.trim());
    setApiKey(settingsKey);
    setProfile({
      xUrl: settingsX.trim(),
      instagramUrl: settingsIg.trim(),
      linkedinUrl: settingsLi.trim(),
    });
    setSettingsOpen(false);
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
          <Popover open={settingsOpen} onOpenChange={handleSettingsOpenChange}>
            <PopoverTrigger
              className="board-toolbar-icon"
              aria-label="Settings"
              title="Settings"
            >
              <Settings className="h-4 w-4 text-foreground/60" />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              sideOffset={12}
              align="start"
              className="board-popover board-popover--settings"
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

              {hasLastSharedBoard && (
                <button
                  type="button"
                  onClick={onDeleteLastShare}
                  disabled={isDeletingShare}
                  className="board-popover-link"
                >
                  {isDeletingShare ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  <span>Delete last shared board</span>
                </button>
              )}
            </PopoverContent>
          </Popover>

          <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
            <PopoverTrigger
              className="board-toolbar-icon"
              aria-label="Recent boards"
              title="Recent boards"
            >
              <Clock3 className="h-4 w-4 text-foreground/60" />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              sideOffset={12}
              align="start"
              className="board-popover board-popover--history"
            >
              <div className="board-popover-section board-history">
                {history.length === 0 ? (
                  <div className="board-history-empty">Recent shares appear here.</div>
                ) : (
                  history.map((entry) => (
                    <div className="board-history-row" key={entry.id}>
                      <button
                        type="button"
                        className="board-history-main"
                        onClick={() => {
                          onOpenHistoryEntry(entry);
                          setHistoryOpen(false);
                        }}
                      >
                        <span className="board-history-title">{entry.title}</span>
                        <span className="board-history-subtitle">{entry.subtitle}</span>
                      </button>
                      <button
                        type="button"
                        className="board-history-remove"
                        aria-label={`Remove ${entry.title} from history`}
                        title="Remove"
                        onClick={() => onRemoveHistoryEntry(entry.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Center: Plus button (pill) with radial fan menu */}
        <div className="board-toolbar-center">
          <ActionFan
            triggerClassName="board-toolbar-add"
            trigger={<Plus className="h-5 w-5" strokeWidth={2.25} />}
            items={fanItems}
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
