"use client";

import { useMemo, useState } from "react";
import { Inbox, Loader2, AlertCircle, Sparkles, Trash2 } from "lucide-react";
import { useInboxList } from "@/lib/vault/hooks/use-inbox-list";
import { useInboxNote } from "@/lib/vault/hooks/use-inbox-note";
import { useDiscardInbox } from "@/lib/vault/hooks/use-discard-inbox";
import { useVaultTree } from "@/lib/vault/hooks/use-vault-tree";
import type { InboxNote } from "@agenticos/vault-core";
import { PromoteReviewDrawer } from "./PromoteReviewDrawer";

export function InboxQueue() {
  const { data: items, isLoading, isError } = useInboxList();
  const { data: tree } = useVaultTree();
  const discard = useDiscardInbox();

  // Path of the note the operator is promoting; drives the body fetch + drawer.
  const [promotePath, setPromotePath] = useState<string | null>(null);
  const { data: promoteNote, isLoading: isPromoteLoading } =
    useInboxNote(promotePath);

  const [discardingPath, setDiscardingPath] = useState<string | null>(null);

  // Top-level wiki folders become the promote categories.
  const categories = useMemo(() => {
    const children = tree?.tree.children ?? [];
    return children
      .filter((node) => node.kind === "folder")
      .map((node) => node.name);
  }, [tree]);

  function handlePromote(note: InboxNote) {
    setPromotePath(note.path);
  }

  function handleDiscard(note: InboxNote) {
    setDiscardingPath(note.path);
    discard.mutate(note.path, {
      onSettled: () => setDiscardingPath(null),
    });
  }

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 p-4 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        <Loader2 size={14} className="animate-spin" />
        Loading inbox…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex items-center gap-2 p-4 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        <AlertCircle size={14} />
        Failed to load inbox
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 p-6 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        <Inbox size={24} />
        <span>Inbox is empty</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2 p-3">
        <div
          className="flex items-center gap-2 mb-1 text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          <Inbox size={12} />
          Inbox ({items.length})
        </div>

        {items.map((note) => {
          const isPromoting =
            promotePath === note.path && (isPromoteLoading || !promoteNote);
          const isDiscarding = discardingPath === note.path;

          return (
            <div
              key={note.path}
              className="rounded-lg border p-3 flex flex-col gap-2"
              style={{
                backgroundColor: "var(--surface-elevated)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--text)" }}
                    title={note.title}
                  >
                    {note.title}
                  </span>
                  <span
                    className="text-xs truncate"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {note.path}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePromote(note)}
                  disabled={isPromoting || isDiscarding}
                  className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--accent-plum-400)",
                    color: "#fff",
                  }}
                >
                  {isPromoting ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Sparkles size={11} />
                  )}
                  {isPromoting ? "Loading…" : "Promote"}
                </button>

                <button
                  onClick={() => handleDiscard(note)}
                  disabled={isPromoting || isDiscarding}
                  className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {isDiscarding ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Trash2 size={11} />
                  )}
                  Discard
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {promotePath && promoteNote && (
        <PromoteReviewDrawer
          inboxPath={promotePath}
          note={promoteNote}
          categories={categories}
          onClose={() => setPromotePath(null)}
        />
      )}
    </>
  );
}
