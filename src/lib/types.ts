import type { LayoutItem } from "react-grid-layout";

export type Platform =
  | "twitter"
  | "linkedin"
  | "instagram"
  | "youtube"
  | "reddit"
  | "threads"
  | "facebook"
  | "tiktok"
  | "website";

export interface UrlItem {
  id: string;
  type: "url";
  url: string;
  platform: Platform;
  ogData?: OGData;
}

export interface DraftImageItem {
  id: string;
  type: "image";
  /** Local preview, e.g. `blob:http://localhost:3000/5d...`. Never persisted. */
  previewUrl: string;
  /** Browser file, e.g. `File{name:"screenshot.png", type:"image/png"}`. Never persisted. */
  file: File;
  mimeType?: string;
  size?: number;
  caption?: string;
  /** Natural pxW/pxH, measured on paste. Used for initial packing so spill-to-next-page decisions match reality. */
  aspect?: number;
}

export interface SharedImageItem {
  id: string;
  type: "image";
  /** Public R2 URL, e.g. `https://pub-.../images/abc123/item1`. */
  url: string;
  /** Canonical R2 object key used for deletion, independent of the public URL shape. */
  objectKey?: string;
  mimeType?: string;
  size?: number;
  caption?: string;
}

export interface NoteItem {
  id: string;
  type: "note";
  text: string;
}

/** Synthetic item for AI overall summary — same grid behavior as other cards; data lives on `generation`. */
export const BOARD_SUMMARY_ITEM_ID = "__summary__" as const;

export interface BoardSummaryItem {
  id: typeof BOARD_SUMMARY_ITEM_ID;
  type: "board_summary";
}

export type CanvasItem =
  | UrlItem
  | DraftImageItem
  | SharedImageItem
  | NoteItem
  | BoardSummaryItem;
export type SharedCanvasItem =
  | UrlItem
  | SharedImageItem
  | NoteItem
  | BoardSummaryItem;

export interface OGData {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  author?: string;
}

export interface ItemSummary {
  item_id: string;
  title: string;
  summary: string;
  source_type?: string;
  author?: string;
  key_quote?: string;
}

export interface OverallSummary {
  title: string;
  explanation: string;
  tags: string[];
}

export interface GenerateResponse {
  item_summaries: ItemSummary[];
  overall_summary: OverallSummary;
}

export interface GridLayouts {
  lg: LayoutItem[];
  sm: LayoutItem[];
}

/** Optional profile links for shared boards (stored with canvas JSON). */
export interface AuthorProfile {
  xUrl?: string;
  instagramUrl?: string;
  linkedinUrl?: string;
}

export interface BoardPage {
  id: string;
  items: CanvasItem[];
  layouts: GridLayouts;
}

export interface SharedBoardPage {
  id: string;
  items: SharedCanvasItem[];
  layouts?: GridLayouts;
}

export interface Canvas {
  id: string;
  author: string;
  authorProfile?: AuthorProfile;
  pages: SharedBoardPage[];
  generation?: GenerateResponse;
  createdAt: string;
  deleteTokenHash?: string;
}

export interface EncryptedShareImage {
  id: string;
  pageId: string;
  key: string;
  url: string;
  iv: string;
  size: number;
}

export interface EncryptedCanvasEnvelope {
  id: string;
  encrypted: true;
  v: 1;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
  images: EncryptedShareImage[];
  createdAt: string;
  pinVerifier?: {
    kdf: "PBKDF2-SHA-256";
    iterations: number;
    salt: string;
    hash: string;
  };
  deleteTokenHash?: string;
}

export interface LockedCanvasStub {
  id: string;
  encrypted: true;
  locked: true;
}

export type StoredCanvas = Canvas | EncryptedCanvasEnvelope | LockedCanvasStub;

export function isEncryptedCanvas(value: StoredCanvas): value is EncryptedCanvasEnvelope {
  return "encrypted" in value && value.encrypted === true && "data" in value;
}

export function isLockedCanvasStub(value: StoredCanvas): value is LockedCanvasStub {
  return "encrypted" in value && value.encrypted === true && "locked" in value;
}

export function isDraftImageItem(item: CanvasItem): item is DraftImageItem {
  return item.type === "image" && "file" in item;
}
