
import { useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { CanvasItem, ItemSummary } from "@/lib/types";

type NoteItem = Extract<CanvasItem, { type: "note" }>;

export function NoteCard({
  item,
  summary,
  readonly,
  onUpdateText,
}: {
  item: NoteItem;
  summary?: ItemSummary;
  readonly?: boolean;
  onUpdateText?: (id: string, text: string) => void;
}) {
  const lastTextRef = useRef(item.text);
  lastTextRef.current = item.text;
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Type something…" }),
    ],
    content: item.text,
    editable: !readonly,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (html === lastTextRef.current) return;
      lastTextRef.current = html;
      onUpdateText?.(item.id, html);
    },
    editorProps: {
      attributes: {
        class: "outline-none h-full",
      },
    },
  });

  return (
    <div className={`flex h-full flex-col bg-card p-4 ${readonly ? "" : "cursor-text"}`}>
      <div className="flex-1 min-h-0 overflow-auto">
        <EditorContent editor={editor} className="h-full text-sm leading-relaxed" />
      </div>
      {summary?.summary && (
        <p className="mt-3 border-t border-border/40 pt-2 text-xs text-muted-foreground shrink-0">
          {summary.summary}
        </p>
      )}
    </div>
  );
}
