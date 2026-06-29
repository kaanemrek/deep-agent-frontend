"use client";

import React, { useState, useRef, useCallback, useMemo, useEffect, FormEvent } from "react";
import { Square, ArrowUp, CheckCircle, Clock, Circle, FileIcon, Workflow, FolderOpen, FolderX, X, Check } from "lucide-react";
import { TokenMeter } from "@/app/components/TokenMeter";
import { ChatMessage } from "@/app/components/ChatMessage";
import type { TodoItem, ToolCall, ActionRequest, ReviewConfig } from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import { extractStringFromMessageContent } from "@/app/utils/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";

interface ChatInterfaceProps { assistant: Assistant | null; }

const SUGGESTIONS = [
  "Explain the architecture",
  "Find potential bugs",
  "How does routing work?",
  "Summarize key modules",
];

export const DIAGRAM_PROMPT =
  "Generate a Mermaid diagram showing the overall module relationships, key classes, and data flow of this codebase. Use a flowchart or class diagram as appropriate.";

const getStatusIcon = (status: TodoItem["status"], className?: string) => {
  switch (status) {
    case "completed": return <CheckCircle size={12} className={cn("shrink-0", className)} style={{ color: "var(--bio-primary)" }} />;
    case "in_progress": return <Clock size={12} className={cn("shrink-0", className)} style={{ color: "#F59E0B" }} />;
    default: return <Circle size={12} className={cn("shrink-0", className)} style={{ color: "var(--bio-muted)" }} />;
  }
};

/* Animated bioluminescent orb */
function BioOrb() {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 72, height: 72 }}>
      {/* Outer rings */}
      <div className="absolute rounded-full" style={{
        width: 72, height: 72,
        border: "1px solid rgba(123,79,255,0.25)",
        animation: "orb-spin-slow 12s linear infinite",
      }} />
      <div className="absolute rounded-full" style={{
        width: 56, height: 56,
        border: "1px solid rgba(0,255,178,0.2)",
        animation: "orb-spin-reverse 8s linear infinite",
      }} />
      <div className="absolute rounded-full" style={{
        width: 40, height: 40,
        border: "1px solid rgba(123,79,255,0.35)",
        animation: "orb-spin-slow 5s linear infinite",
      }} />
      {/* Core glow */}
      <div className="relative rounded-full" style={{
        width: 28, height: 28,
        background: "radial-gradient(circle at 40% 35%, #00FFB2, rgba(0,255,178,0.15) 70%, transparent)",
        boxShadow: "0 0 20px rgba(0,255,178,0.4), 0 0 40px rgba(0,255,178,0.15)",
        animation: "orb-breathe 3s ease-in-out infinite",
        filter: "blur(0.5px)",
      }} />
    </div>
  );
}

const RECENT_REPOS_KEY = "pinned-repos-recent";
const loadRecentRepos = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) || "[]"); }
  catch { return []; }
};
const saveRecentRepo = (path: string) => {
  const next = [path, ...loadRecentRepos().filter((p) => p !== path)].slice(0, 6);
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(next));
};

export const ChatInterface = React.memo<ChatInterfaceProps>(({ assistant }) => {
  const [metaOpen, setMetaOpen]       = useState<"tasks" | "files" | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const tasksContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef       = useRef<HTMLTextAreaElement | null>(null);
  const [input, setInput] = useState("");
  const { scrollRef, contentRef } = useStickToBottom();

  // ── Repo pin state ──────────────────────────────────────────────────────────
  const [pinnedRepo,      setPinnedRepo]      = useState<string | null>(null);
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false);
  const [repoInput,       setRepoInput]       = useState("");
  const [recentRepos,     setRecentRepos]     = useState<string[]>([]);
  const repoBtnRef     = useRef<HTMLButtonElement | null>(null);
  const repoPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setRecentRepos(loadRecentRepos()); }, []);

  // close popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        repoPopoverRef.current && !repoPopoverRef.current.contains(e.target as Node) &&
        repoBtnRef.current    && !repoBtnRef.current.contains(e.target as Node)
      ) setRepoPopoverOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const confirmRepo = useCallback(() => {
    const path = repoInput.trim();
    if (!path) return;
    setPinnedRepo(path);
    saveRecentRepo(path);
    setRecentRepos(loadRecentRepos());
    setRepoPopoverOpen(false);
  }, [repoInput]);

  const clearRepo = useCallback(() => {
    setPinnedRepo(null);
    setRepoInput("");
    setRepoPopoverOpen(false);
  }, []);
  // ───────────────────────────────────────────────────────────────────────────

  const {
    stream, messages, todos, files, ui, setFiles,
    isLoading, isThreadLoading, interrupt,
    sendMessage, stopStream, resumeInterrupt,
  } = useChatContext();

  const submitDisabled = isLoading || !assistant;

  const handleSubmit = useCallback((e?: FormEvent) => {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || isLoading || submitDisabled) return;
    const content = pinnedRepo ? `Repo path: ${pinnedRepo}\n\n${text}` : text;
    sendMessage(content);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, isLoading, sendMessage, submitDisabled, pinnedRepo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (submitDisabled) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }, [handleSubmit, submitDisabled]);

  const processedMessages = useMemo(() => {
    const messageMap = new Map<string, { message: Message; toolCalls: ToolCall[] }>();
    messages.forEach((message: Message) => {
      if (message.type === "ai") {
        const raw: Array<{ id?: string; function?: { name?: string; arguments?: unknown }; name?: string; type?: string; args?: unknown; input?: unknown; }> = [];
        if (message.additional_kwargs?.tool_calls && Array.isArray(message.additional_kwargs.tool_calls)) {
          raw.push(...message.additional_kwargs.tool_calls);
        } else if (message.tool_calls && Array.isArray(message.tool_calls)) {
          raw.push(...message.tool_calls.filter((tc: { name?: string }) => tc.name !== ""));
        } else if (Array.isArray(message.content)) {
          raw.push(...message.content.filter((b: { type?: string }) => b.type === "tool_use"));
        }
        const toolCalls = raw.map((tc) => ({
          id:   tc.id || `tool-${Math.random()}`,
          name: tc.function?.name || tc.name || tc.type || "unknown",
          args: tc.function?.arguments || tc.args || tc.input || {},
          status: interrupt ? "interrupted" : ("pending" as const),
        } as ToolCall));
        messageMap.set(message.id!, { message, toolCalls });
      } else if (message.type === "tool") {
        const tcId = message.tool_call_id;
        if (!tcId) return;
        for (const [, data] of messageMap.entries()) {
          const idx = data.toolCalls.findIndex((tc) => tc.id === tcId);
          if (idx === -1) continue;
          data.toolCalls[idx] = { ...data.toolCalls[idx], status: "completed" as const, result: extractStringFromMessageContent(message) };
          break;
        }
      } else if (message.type === "human") {
        messageMap.set(message.id!, { message, toolCalls: [] });
      }
    });
    const arr = Array.from(messageMap.values());
    return arr.map((data, i) => ({
      ...data,
      showAvatar: data.message.type !== (i > 0 ? arr[i - 1].message.type : null),
    }));
  }, [messages, interrupt]);

  const groupedTodos = {
    in_progress: todos.filter((t) => t.status === "in_progress"),
    pending:     todos.filter((t) => t.status === "pending"),
    completed:   todos.filter((t) => t.status === "completed"),
  };
  const hasTasks = todos.length > 0;
  const hasFiles = Object.keys(files).length > 0;
  const hasMessages = processedMessages.length > 0;

  const actionRequestsMap = useMemo(() => {
    const ar = interrupt?.value && (interrupt.value as any)["action_requests"];
    if (!ar) return new Map<string, ActionRequest>();
    return new Map(ar.map((r: ActionRequest) => [r.name, r]));
  }, [interrupt]);

  const reviewConfigsMap = useMemo(() => {
    const rc = interrupt?.value && (interrupt.value as any)["review_configs"];
    if (!rc) return new Map<string, ReviewConfig>();
    return new Map(rc.map((r: ReviewConfig) => [r.actionName, r]));
  }, [interrupt]);

  return (
    <div className="bio-mesh flex min-h-0 flex-1 flex-col overflow-hidden" style={{ background: "radial-gradient(ellipse at 50% 40%, #0A0F14 0%, #060809 100%)" }}>

      {/* ── Messages area ── */}
      <div className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden" ref={scrollRef}>
        <div className="mx-auto w-full max-w-[800px] space-y-6 px-6 pb-6 pt-8" ref={contentRef}>

          {isThreadLoading && (
            <div className="flex items-center justify-center gap-2 py-20">
              {[0,1,2].map((i) => (
                <span key={i} className="loading-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--bio-primary)" }} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isThreadLoading && !hasMessages && (
            <div className="flex flex-col items-center justify-center gap-8 py-20 text-center">
              <BioOrb />
              <div style={{ animation: "type-reveal 0.6s var(--ease-snap) 0.3s both" }}>
                <div className="flex items-center justify-center gap-3">
                  {assistant?.graph_id && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                        fontWeight: 500,
                        color: "#60A5FA",
                        letterSpacing: "0.04em",
                        textShadow: "0 0 12px rgba(96,165,250,0.5)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {assistant.graph_id === "deep_agent" ? "↳ Deep Agent" : assistant.graph_id === "standard_agent" ? "↳ Standard Agent" : `↳ ${assistant.graph_id}`}
                    </span>
                  )}
                  <p style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "22px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "var(--bio-text)",
                    marginBottom: 0,
                  }}>
                    Ask anything about the codebase.
                  </p>
                </div>
              </div>
              {/* Suggestion chips */}
              <div
                className="flex flex-wrap justify-center gap-2"
                style={{ animation: "type-reveal 0.5s var(--ease-snap) 0.6s both" }}
              >
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { if (!submitDisabled) sendMessage(s); }}
                    disabled={submitDisabled}
                    className="rounded-full px-4 py-2 text-[12px] transition-all duration-150"
                    style={{
                      border: "1px solid rgba(0,255,178,0.2)",
                      background: "transparent",
                      color: "rgba(232,237,242,0.6)",
                      fontFamily: "var(--font-sans)",
                      letterSpacing: "0.01em",
                      cursor: submitDisabled ? "not-allowed" : "pointer",
                    }}
                    onMouseEnter={(e) => {
                      if (!submitDisabled) {
                        (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.07)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,178,0.4)";
                        (e.currentTarget as HTMLElement).style.color = "var(--bio-text)";
                        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,255,178,0.1)";
                        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,178,0.2)";
                      (e.currentTarget as HTMLElement).style.color = "rgba(232,237,242,0.6)";
                      (e.currentTarget as HTMLElement).style.boxShadow = "none";
                      (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                    }}
                  >
                    {s}
                  </button>
                ))}

                {/* Diagram shortcut chip */}
                <button
                  onClick={() => { if (!submitDisabled) sendMessage(DIAGRAM_PROMPT); }}
                  disabled={submitDisabled}
                  className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] transition-all duration-150"
                  style={{
                    border: "1px solid rgba(0,255,178,0.35)",
                    background: "rgba(0,255,178,0.05)",
                    color: "var(--bio-primary)",
                    fontFamily: "var(--font-sans)",
                    letterSpacing: "0.01em",
                    cursor: submitDisabled ? "not-allowed" : "pointer",
                    opacity: submitDisabled ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!submitDisabled) {
                      (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.12)";
                      (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,255,178,0.15)";
                      (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.05)";
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                    (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                  }}
                >
                  <Workflow size={12} />
                  Generate diagram
                </button>
              </div>
            </div>
          )}

          {/* Messages */}
          {!isThreadLoading && processedMessages.map((data, index) => {
            const msgUi   = ui?.filter((u: any) => u.metadata?.message_id === data.message.id);
            const isLast  = index === processedMessages.length - 1;
            return (
              <ChatMessage
                key={data.message.id}
                message={data.message}
                toolCalls={data.toolCalls}
                isLoading={isLoading}
                actionRequestsMap={isLast ? actionRequestsMap as Map<string, ActionRequest> : undefined}
                reviewConfigsMap={isLast ? reviewConfigsMap as Map<string, ReviewConfig> : undefined}
                ui={msgUi}
                stream={stream}
                onResumeInterrupt={resumeInterrupt}
                graphId={assistant?.graph_id}
              />
            );
          })}
        </div>
      </div>

      {/* ── Input area ── */}
      <div
        className="relative z-10 shrink-0 px-6 pb-6 pt-3"
        style={{ borderTop: "1px solid rgba(0,255,178,0.07)" }}
      >
        <div className="mx-auto w-full max-w-[800px]">

          {/* Task / files pill strip */}
          {(hasTasks || hasFiles) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {hasTasks && (
                <button
                  onClick={() => setMetaOpen((p) => p === "tasks" ? null : "tasks")}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition-all"
                  style={{
                    border: "1px solid var(--bio-border)",
                    background: "rgba(13,17,23,0.8)",
                    color: "var(--bio-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {(() => {
                    const active = todos.find((t) => t.status === "in_progress");
                    const done   = todos.length - groupedTodos.pending.length;
                    if (todos.length === done) return <><CheckCircle size={10} style={{ color: "var(--bio-primary)" }} /> all done</>;
                    if (active) return <><Clock size={10} style={{ color: "#F59E0B" }} />{done}/{todos.length} — {active.content.slice(0, 28)}{active.content.length > 28 ? "…" : ""}</>;
                    return <><Circle size={10} />{done}/{todos.length} tasks</>;
                  })()}
                </button>
              )}
              {hasFiles && (
                <button
                  onClick={() => setMetaOpen((p) => p === "files" ? null : "files")}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition-all"
                  style={{ border: "1px solid var(--bio-border)", background: "rgba(13,17,23,0.8)", color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
                >
                  <FileIcon size={10} />
                  {Object.keys(files).length} files
                </button>
              )}
            </div>
          )}

          {/* Expanded panel */}
          {metaOpen && (
            <div
              ref={tasksContainerRef}
              className="mb-2 max-h-56 overflow-y-auto rounded-xl p-4"
              style={{ background: "rgba(13,17,23,0.95)", border: "1px solid var(--bio-border)" }}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex gap-3 text-[11px]" style={{ fontFamily: "var(--font-mono)" }}>
                  {hasTasks && <button onClick={() => setMetaOpen("tasks")} style={{ color: metaOpen === "tasks" ? "var(--bio-primary)" : "var(--bio-muted)" }}>tasks</button>}
                  {hasFiles && <button onClick={() => setMetaOpen("files")} style={{ color: metaOpen === "files" ? "var(--bio-primary)" : "var(--bio-muted)" }}>files</button>}
                </div>
                <button onClick={() => setMetaOpen(null)} style={{ color: "var(--bio-muted)", fontSize: "11px", fontFamily: "var(--font-mono)" }}>✕</button>
              </div>
              {metaOpen === "tasks" && Object.entries(groupedTodos).filter(([, l]) => l.length > 0).map(([status, list]) => (
                <div key={status} className="mb-3 last:mb-0">
                  <p className="mb-1.5 text-[9px] uppercase tracking-widest" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
                    {{ pending: "pending", in_progress: "in progress", completed: "done" }[status]}
                  </p>
                  <div className="space-y-1">
                    {list.map((todo, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12px]" style={{ color: "rgba(232,237,242,0.75)" }}>
                        {getStatusIcon(todo.status, "mt-0.5")}
                        {todo.content}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {metaOpen === "files" && <FilesPopover files={files} setFiles={setFiles} editDisabled={isLoading === true || interrupt !== undefined} />}
            </div>
          )}

          {/* Token meter — only when there are messages */}
          {messages.length > 0 && (
            <div className="mb-2 flex justify-end">
              <TokenMeter messages={messages} isLoading={isLoading} compact />
            </div>
          )}

          {/* Main input card — wrapped in relative for popover */}
          <div className="relative">

            {/* ── Repo pin popover ── */}
            {repoPopoverOpen && (
              <div
                ref={repoPopoverRef}
                className="absolute bottom-[calc(100%+8px)] left-0 right-0 rounded-2xl overflow-hidden z-50"
                style={{
                  background: "#0D1117",
                  border: "1px solid rgba(0,255,178,0.25)",
                  boxShadow: "0 -8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,255,178,0.08)",
                }}
              >
                {/* header */}
                <div
                  className="flex items-center justify-between px-4 py-2.5"
                  style={{ borderBottom: "1px solid rgba(0,255,178,0.08)" }}
                >
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--bio-primary)", fontFamily: "var(--font-mono)" }}>
                    repo sabitle
                  </span>
                  <button
                    type="button"
                    onClick={() => setRepoPopoverOpen(false)}
                    className="flex h-5 w-5 items-center justify-center rounded-md"
                    style={{ color: "var(--bio-muted)" }}
                  >
                    <X size={12} />
                  </button>
                </div>

                {/* path input */}
                <div className="flex items-center gap-2 px-4 py-3">
                  <FolderOpen size={13} style={{ color: "var(--bio-primary)", flexShrink: 0 }} />
                  <input
                    autoFocus
                    type="text"
                    value={repoInput}
                    onChange={(e) => setRepoInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmRepo(); }}
                    placeholder="/Users/name/my-project"
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      fontSize: "13px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--bio-text)",
                    }}
                  />
                  <button
                    type="button"
                    onClick={confirmRepo}
                    disabled={!repoInput.trim()}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-all"
                    style={{
                      background: repoInput.trim() ? "var(--bio-primary)" : "rgba(255,255,255,0.05)",
                      color: repoInput.trim() ? "#080B0F" : "var(--bio-muted)",
                      cursor: repoInput.trim() ? "pointer" : "not-allowed",
                    }}
                  >
                    <Check size={11} />
                  </button>
                </div>

                {/* recent repos */}
                {recentRepos.length > 0 && (
                  <div style={{ borderTop: "1px solid rgba(0,255,178,0.06)" }}>
                    <p className="px-4 pb-1 pt-2 text-[9px] uppercase tracking-widest" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
                      son kullanılanlar
                    </p>
                    {recentRepos.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => { setPinnedRepo(r); setRepoInput(r); setRepoPopoverOpen(false); }}
                        className="flex w-full items-center gap-2 px-4 py-1.5 text-left transition-all"
                        style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--bio-muted)" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.05)"; (e.currentTarget as HTMLElement).style.color = "var(--bio-text)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; }}
                      >
                        <FolderOpen size={11} style={{ flexShrink: 0, color: "var(--bio-primary)", opacity: 0.6 }} />
                        <span className="truncate">{r}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* clear button — only when a repo is pinned */}
                {pinnedRepo && (
                  <div className="px-4 pb-3 pt-2" style={{ borderTop: "1px solid rgba(0,255,178,0.06)" }}>
                    <button
                      type="button"
                      onClick={clearRepo}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] transition-all"
                      style={{ color: "rgba(255,79,107,0.7)", background: "rgba(255,79,107,0.06)", border: "1px solid rgba(255,79,107,0.15)" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,79,107,0.12)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,79,107,0.06)"; }}
                    >
                      <FolderX size={11} />
                      sabitlemeyi kaldır
                    </button>
                  </div>
                )}
              </div>
            )}

            <div
              className="rounded-2xl transition-all duration-200"
              style={{
                background: "#0D1117",
                border: inputFocused ? "1px solid rgba(0,255,178,0.5)" : "1px solid rgba(0,255,178,0.2)",
                boxShadow: inputFocused ? "0 0 20px rgba(0,255,178,0.08)" : "none",
                transition: "border-color 200ms var(--ease-snap), box-shadow 200ms var(--ease-snap)",
              }}
            >
              {/* ── Active repo badge (visible when pinned) ── */}
              {pinnedRepo && (
                <div
                  className="flex items-center gap-2 px-4 py-2"
                  style={{ borderBottom: "1px solid rgba(0,255,178,0.08)" }}
                >
                  <FolderOpen size={11} style={{ color: "var(--bio-primary)", flexShrink: 0 }} />
                  <span
                    className="truncate flex-1 text-[10px]"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--bio-primary)", opacity: 0.85 }}
                    title={pinnedRepo}
                  >
                    {pinnedRepo}
                  </span>
                  <button
                    type="button"
                    onClick={clearRepo}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                    style={{ color: "var(--bio-muted)" }}
                    title="Sabitlemeyi kaldır"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,79,107,0.8)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; }}
                  >
                    <X size={10} />
                  </button>
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div className="flex items-end gap-3 px-4 py-3.5">
                  {/* Agent indicator */}
                  {assistant?.graph_id && (
                    <span
                      className="mb-0.5 shrink-0 self-center text-[10px]"
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "#60A5FA",
                        textShadow: "0 0 10px rgba(96,165,250,0.45)",
                        letterSpacing: "0.04em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {assistant.graph_id === "deep_agent" ? "↳ deep" : assistant.graph_id === "standard_agent" ? "↳ std" : `↳ ${assistant.graph_id}`}
                    </span>
                  )}
                  <div className="flex-1">
                    {isLoading && !input ? (
                      <div className="flex items-center gap-1.5 py-0.5">
                        {[0,1,2].map((i) => (
                          <span key={i} className="loading-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--bio-primary)" }} />
                        ))}
                      </div>
                    ) : (
                      <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => {
                          setInput(e.target.value);
                          e.target.style.height = "auto";
                          e.target.style.height = `${e.target.scrollHeight}px`;
                        }}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setInputFocused(true)}
                        onBlur={() => setInputFocused(false)}
                        placeholder={isLoading ? "Running…" : "Ask anything about the codebase…"}
                        rows={1}
                        style={{
                          width: "100%",
                          resize: "none",
                          overflow: "hidden",
                          maxHeight: "180px",
                          background: "transparent",
                          border: "none",
                          outline: "none",
                          boxShadow: "none",
                          fontFamily: "var(--font-sans)",
                          fontSize: "14px",
                          lineHeight: "1.6",
                          color: "var(--bio-text)",
                          fontStyle: input ? "normal" : "italic",
                        }}
                      />
                    )}
                  </div>

                  {/* Repo pin button */}
                  {!isLoading && (
                    <button
                      ref={repoBtnRef}
                      type="button"
                      onClick={() => {
                        setRepoInput(pinnedRepo ?? "");
                        setRepoPopoverOpen((p) => !p);
                      }}
                      title={pinnedRepo ? `Repo: ${pinnedRepo}` : "Repo sabitle"}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-150"
                      style={{
                        background: pinnedRepo ? "rgba(0,255,178,0.12)" : "rgba(255,255,255,0.04)",
                        border: pinnedRepo ? "1px solid rgba(0,255,178,0.3)" : "1px solid rgba(255,255,255,0.07)",
                        color: pinnedRepo ? "var(--bio-primary)" : "var(--bio-muted)",
                        boxShadow: pinnedRepo ? "0 0 10px rgba(0,255,178,0.15)" : "none",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.1)";
                        (e.currentTarget as HTMLElement).style.color = "var(--bio-primary)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = pinnedRepo ? "rgba(0,255,178,0.12)" : "rgba(255,255,255,0.04)";
                        (e.currentTarget as HTMLElement).style.color = pinnedRepo ? "var(--bio-primary)" : "var(--bio-muted)";
                      }}
                    >
                      <FolderOpen size={14} />
                    </button>
                  )}

                  {/* Diagram button */}
                  {!isLoading && (
                    <button
                      type="button"
                      disabled={submitDisabled}
                      onClick={() => { if (!submitDisabled) sendMessage(DIAGRAM_PROMPT); }}
                      title="Generate architecture diagram"
                      className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 transition-all duration-150 text-[12px] font-medium"
                      style={{
                        background: "rgba(0,255,178,0.06)",
                        border: "1px solid rgba(0,255,178,0.18)",
                        color: submitDisabled ? "var(--bio-muted)" : "var(--bio-primary)",
                        cursor: submitDisabled ? "not-allowed" : "pointer",
                        opacity: submitDisabled ? 0.4 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!submitDisabled) {
                          (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.12)";
                          (e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px rgba(0,255,178,0.2)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.06)";
                        (e.currentTarget as HTMLElement).style.boxShadow = "none";
                      }}
                    >
                      <Workflow size={14} />
                      <span>Create diagram</span>
                    </button>
                  )}

                  {/* Send / Stop button */}
                  <button
                    type={isLoading ? "button" : "submit"}
                    onClick={isLoading ? stopStream : undefined}
                    disabled={!isLoading && (submitDisabled || !input.trim())}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-150"
                    style={{
                      background: isLoading
                        ? "rgba(255,79,107,0.15)"
                        : input.trim() && !submitDisabled
                          ? "var(--bio-primary)"
                          : "rgba(255,255,255,0.05)",
                      color: isLoading
                        ? "#FF4F6B"
                        : input.trim() && !submitDisabled
                          ? "#080B0F"
                          : "var(--bio-muted)",
                      boxShadow: input.trim() && !submitDisabled && !isLoading
                        ? "0 0 16px rgba(0,255,178,0.35)"
                        : "none",
                      cursor: !isLoading && (submitDisabled || !input.trim()) ? "not-allowed" : "pointer",
                    }}
                    aria-label={isLoading ? "Stop" : "Send"}
                  >
                    {isLoading ? <Square size={12} /> : <ArrowUp size={14} />}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";
