"use client";

import { sanitizeOpenaiApiKeyInput } from "@/lib/openai-api-key";
import type { AuthorProfile, Canvas } from "@/lib/types";

const KEYS = {
  apiKey: "shareboard_api_key",
  name: "shareboard_name",
  profile: "shareboard_profile",
  draft: "shareboard_draft",
  lastShare: "shareboard_last_share",
  history: "shareboard_history",
} as const;

type LastShare = {
  id: string;
  deleteToken: string;
  shareUrl: string;
};

export type BoardHistoryEntry = {
  id: string;
  kind: "tiny" | "stored";
  title: string;
  subtitle: string;
  shareUrl: string;
  createdAt: string;
  itemCount: number;
  pageCount: number;
  canvas?: Canvas;
};

const MAX_HISTORY = 12;

function notifySettingsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("shareboard-settings"));
}

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(KEYS.apiKey) ?? "";
}

export function setApiKey(key: string) {
  localStorage.setItem(KEYS.apiKey, sanitizeOpenaiApiKeyInput(key));
  notifySettingsChanged();
}

export function getName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(KEYS.name) ?? "";
}

export function setName(name: string) {
  localStorage.setItem(KEYS.name, name);
  notifySettingsChanged();
}

const emptyProfile: AuthorProfile = {};

export function getProfile(): AuthorProfile {
  if (typeof window === "undefined") return { ...emptyProfile };
  const raw = localStorage.getItem(KEYS.profile);
  if (!raw) return { ...emptyProfile };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...emptyProfile };
    const o = parsed as Record<string, unknown>;
    return {
      ...(typeof o.xUrl === "string" ? { xUrl: o.xUrl } : {}),
      ...(typeof o.instagramUrl === "string" ? { instagramUrl: o.instagramUrl } : {}),
      ...(typeof o.linkedinUrl === "string" ? { linkedinUrl: o.linkedinUrl } : {}),
    };
  } catch {
    return { ...emptyProfile };
  }
}

export function setProfile(profile: AuthorProfile) {
  const trimmed: AuthorProfile = {};
  if (profile.xUrl?.trim()) trimmed.xUrl = profile.xUrl.trim();
  if (profile.instagramUrl?.trim()) trimmed.instagramUrl = profile.instagramUrl.trim();
  if (profile.linkedinUrl?.trim()) trimmed.linkedinUrl = profile.linkedinUrl.trim();
  if (Object.keys(trimmed).length === 0) {
    localStorage.removeItem(KEYS.profile);
  } else {
    localStorage.setItem(KEYS.profile, JSON.stringify(trimmed));
  }
  notifySettingsChanged();
}

export function isSetup(): boolean {
  return !!getName().trim();
}

export function saveLastSharedBoard(value: LastShare) {
  localStorage.setItem(KEYS.lastShare, JSON.stringify(value));
}

export function getLastSharedBoard(): LastShare | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEYS.lastShare);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastShare;
  } catch {
    return null;
  }
}

export function clearLastSharedBoard() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEYS.lastShare);
}

export function getBoardHistory(): BoardHistoryEntry[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(KEYS.history);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is BoardHistoryEntry => {
        if (!entry || typeof entry !== "object") return false;
        const e = entry as Record<string, unknown>;
        return (
          typeof e.id === "string" &&
          (e.kind === "tiny" || e.kind === "stored") &&
          typeof e.title === "string" &&
          typeof e.subtitle === "string" &&
          typeof e.shareUrl === "string" &&
          typeof e.createdAt === "string" &&
          typeof e.itemCount === "number" &&
          typeof e.pageCount === "number"
        );
      })
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

export function saveBoardHistory(entry: BoardHistoryEntry) {
  if (typeof window === "undefined") return;
  const next = [
    entry,
    ...getBoardHistory().filter((item) => item.id !== entry.id && item.shareUrl !== entry.shareUrl),
  ].slice(0, MAX_HISTORY);
  localStorage.setItem(KEYS.history, JSON.stringify(next));
}

export function removeBoardHistoryEntry(id: string) {
  if (typeof window === "undefined") return;
  const next = getBoardHistory().filter((entry) => entry.id !== id);
  if (next.length) localStorage.setItem(KEYS.history, JSON.stringify(next));
  else localStorage.removeItem(KEYS.history);
}
