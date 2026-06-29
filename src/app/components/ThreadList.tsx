"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { format } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
import { useQueryState } from "nuqs";
import { cn } from "@/lib/utils";
import type { ThreadItem } from "@/app/hooks/useThreads";
import { useThreads } from "@/app/hooks/useThreads";
import { useClient } from "@/providers/ClientProvider";

type StatusFilter = "all" | "idle" | "busy" | "interrupted" | "error";

const GROUP_LABELS = {
  interrupted: "Needs attention",
  today:       "Today",
  yesterday:   "Yesterday",
  week:        "This week",
  older:       "Older",
} as const;

function BlobDot({ status, recency, assistantId }: { status: ThreadItem["status"]; recency: "fresh" | "mid" | "old"; assistantId?: string }) {
  const isStandard = assistantId === "standard_agent";
  const primary = isStandard ? "#7B4FFF" : "#00FFB2";
  const midColor = isStandard ? "#9D7BFF" : "#4AFFC7";
  const oldColor = isStandard ? "#5A39D1" : "#00B37A";

  const color =
    status === "interrupted" ? "#FF4F6B" :
    status === "error"       ? "#FF4F6B" :
    status === "busy"        ? "#FFA500" :
    recency === "fresh"      ? primary :
    recency === "mid"        ? midColor :
                               oldColor;

  const isBusy = status === "busy";

  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: 10, height: 10 }}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: isBusy ? "blob-pulse 2s ease-in-out infinite" : "none" }}>
        <path
          d="M5 1C6.5 0.5 9 2 9.2 4.5C9.5 7 7.5 9.5 5 9.2C2.5 9 0.5 7 0.8 4.5C1 2 3.5 1.5 5 1Z"
          fill={color}
          fillOpacity={recency === "old" ? 0.5 : 0.85}
        />
      </svg>
      {isBusy && (
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: color,
            animation: "bio-ping 2s ease-out infinite",
            borderRadius: "50%",
            opacity: 0.4,
          }}
        />
      )}
    </span>
  );
}

function formatTime(date: Date, now = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return format(date, "HH:mm");
  if (days === 1) return "Yest";
  if (days < 7)  return format(date, "EEE");
  return format(date, "MM/dd");
}

function getRecency(date: Date): "fresh" | "mid" | "old" {
  const h = (Date.now() - date.getTime()) / 3600000;
  if (h < 2)  return "fresh";
  if (h < 48) return "mid";
  return "old";
}

interface ThreadListProps {
  onThreadSelect:          (thread: ThreadItem) => void;
  onMutateReady?:          (mutate: () => void) => void;
  onInterruptCountChange?: (count: number) => void;
}

export function ThreadList({ onThreadSelect, onMutateReady, onInterruptCountChange }: ThreadListProps) {
  const [currentThreadId, setCurrentThreadId] = useQueryState("threadId");
  const [statusFilter]  = useState<StatusFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const client = useClient();

  const threads = useThreads({ status: statusFilter === "all" ? undefined : statusFilter, limit: 30 });
  const flattened = useMemo(() => threads.data?.flat() ?? [], [threads.data]);
  const isEmpty = threads.data?.at(0)?.length === 0;
  const isReachingEnd = isEmpty || (threads.data?.at(-1)?.length ?? 0) < 30;
  const isLoadingMore = threads.size > 0 && threads.data?.[threads.size - 1] == null;

  const grouped = useMemo(() => {
    const now = new Date();
    const g: Record<keyof typeof GROUP_LABELS, ThreadItem[]> = {
      interrupted: [], today: [], yesterday: [], week: [], older: [],
    };
    flattened.forEach((t) => {
      if (t.status === "interrupted") { g.interrupted.push(t); return; }
      const days = Math.floor((now.getTime() - t.updatedAt.getTime()) / 86400000);
      if (days === 0)      g.today.push(t);
      else if (days === 1) g.yesterday.push(t);
      else if (days < 7)  g.week.push(t);
      else                 g.older.push(t);
    });
    return g;
  }, [flattened]);

  const interruptedCount = useMemo(() => flattened.filter((t) => t.status === "interrupted").length, [flattened]);

  const handleDelete = useCallback(async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(threadId);
    try {
      await client.threads.delete(threadId);
      if (currentThreadId === threadId) setCurrentThreadId(null);
      threads.mutate();
    } catch {
      // silently ignore
    } finally {
      setDeletingId(null);
    }
  }, [client, currentThreadId, deletingId, setCurrentThreadId, threads]);

  const onMutateReadyRef = useRef(onMutateReady);
  const mutateRef        = useRef(threads.mutate);
  useEffect(() => { onMutateReadyRef.current = onMutateReady; }, [onMutateReady]);
  useEffect(() => { mutateRef.current = threads.mutate; }, [threads.mutate]);
  const mutateFn = useCallback(() => { mutateRef.current(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onMutateReadyRef.current?.(mutateFn); }, []);
  useEffect(() => { onInterruptCountChange?.(interruptedCount); }, [interruptedCount, onInterruptCountChange]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-2">

        {/* Loading skeletons */}
        {!threads.data && threads.isLoading && (
          <div className="space-y-1 px-3 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-9 rounded-lg"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  animation: "pulse-dot 1.8s ease-in-out infinite",
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* Error */}
        {threads.error && (
          <p className="px-4 py-3 text-xs" style={{ color: "#FF4F6B", fontFamily: "var(--font-mono)" }}>
            // failed to load threads
          </p>
        )}

        {/* Empty */}
        {!threads.error && !threads.isLoading && isEmpty && (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <div className="mb-1 flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--bio-primary)", opacity: 0.3, animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
            <p className="text-[11px]" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
              no conversations yet
            </p>
          </div>
        )}

        {/* Thread groups */}
        {!threads.error && !isEmpty && (
          <div className="px-2">
            {(Object.keys(GROUP_LABELS) as Array<keyof typeof GROUP_LABELS>).map((group) => {
              const list = grouped[group];
              if (list.length === 0) return null;
              return (
                <div key={group} className="mb-4">
                  <p
                    className="mb-1.5 px-2 text-[9px] uppercase tracking-widest"
                    style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
                  >
                    {GROUP_LABELS[group]}
                    {group === "interrupted" && interruptedCount > 0 && (
                      <span
                        className="ml-2 rounded-full px-1.5 py-0.5 text-[9px]"
                        style={{ background: "rgba(255,79,107,0.15)", color: "#FF4F6B" }}
                      >
                        {interruptedCount}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {list.map((thread, idx) => {
                      const isActive   = currentThreadId === thread.id;
                      const isHovered  = hoveredId === thread.id;
                      const isDeleting = deletingId === thread.id;
                      return (
                        <div
                          key={thread.id}
                          className={cn("thread-item group relative rounded-lg", isActive && "active")}
                          style={{
                            background: isActive ? "rgba(0,255,178,0.06)" : "transparent",
                            animation: `stagger-in 0.3s var(--ease-snap) both`,
                            animationDelay: `${idx * 40}ms`,
                          }}
                          onMouseEnter={() => setHoveredId(thread.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          {/* Main clickable area */}
                          <button
                            type="button"
                            onClick={() => onThreadSelect(thread)}
                            className="w-full px-3 py-2 text-left"
                          >
                            <div className="flex items-center gap-2.5">
                              <BlobDot status={thread.status} recency={getRecency(thread.updatedAt)} assistantId={thread.assistantId} />
                              <span className="min-w-0 flex-1">
                                <span
                                  className="block truncate text-[12px] font-medium"
                                  style={{ color: isActive ? "var(--bio-text)" : "rgba(232,237,242,0.7)" }}
                                >
                                  {thread.title}
                                </span>
                                {thread.description && (
                                  <span
                                    className="block truncate text-[11px] leading-4"
                                    style={{ color: "var(--bio-muted)" }}
                                  >
                                    {thread.description}
                                  </span>
                                )}
                              </span>
                              {/* Timestamp — hides when delete button visible */}
                              <span
                                className="shrink-0 text-[10px] transition-opacity duration-100"
                                style={{
                                  color: "var(--bio-muted)",
                                  fontFamily: "var(--font-mono)",
                                  opacity: isHovered ? 0 : 1,
                                }}
                              >
                                {formatTime(thread.updatedAt)}
                              </span>
                            </div>
                          </button>

                          {/* Delete button — appears on hover */}
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, thread.id)}
                            disabled={!!deletingId}
                            title="Delete conversation"
                            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150"
                            style={{
                              opacity: isHovered && !isDeleting ? 1 : 0,
                              pointerEvents: isHovered && !isDeleting ? "auto" : "none",
                              background: "transparent",
                              color: "var(--bio-muted)",
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLElement).style.background = "rgba(255,79,107,0.12)";
                              (e.currentTarget as HTMLElement).style.color = "#FF4F6B";
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLElement).style.background = "transparent";
                              (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)";
                            }}
                          >
                            {isDeleting ? (
                              <Loader2 className="h-3 w-3 animate-spin" style={{ color: "#FF4F6B" }} />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {!isReachingEnd && (
              <button
                onClick={() => threads.setSize(threads.size + 1)}
                disabled={isLoadingMore}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] transition-colors"
                style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
              >
                {isLoadingMore
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> loading...</>
                  : "load more"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
