"use client";

import {
  useState, useRef, useCallback, useEffect, useMemo, Suspense,
} from "react";
import { ArrowUp, ArrowLeft, Zap, Clock, Plus, PanelLeftClose, PanelLeft, Trash2 } from "lucide-react";
import { getConfig, StandaloneConfig } from "@/lib/config";
import { ClientProvider, useClient } from "@/providers/ClientProvider";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import { useCompareChat } from "@/app/hooks/useCompareChat";
import { TokenMeter } from "@/app/components/TokenMeter";
import { ChatMessage } from "@/app/components/ChatMessage";
import { extractStringFromMessageContent } from "@/app/utils/utils";
import Link from "next/link";
import { useStickToBottom } from "use-stick-to-bottom";
import type { ToolCall } from "@/app/types/types";
import { cn } from "@/lib/utils";

/* ── Session storage ─────────────────────────────────────────── */

const STORAGE_KEY = "coagent-sessions";

interface CoAgentSession {
  id: string;
  title: string;
  createdAt: string;
  deepThreadId: string;
  standardThreadId: string;
}

function loadSessions(): CoAgentSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveSession(session: CoAgentSession) {
  const sessions = loadSessions().filter((s) => s.id !== session.id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([session, ...sessions]));
}

function deleteSession(id: string) {
  const sessions = loadSessions().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

/* ── Single panel ─────────────────────────────────────────── */
interface PanelProps {
  assistant:   Assistant | null;
  label:       string;
  accent:      string;
  initialThreadId?: string | null;
  onSendReady: (fn: (text: string) => void) => void;
  onThreadId:  (id: string) => void;
}

function ComparePanel({
  assistant, label, accent, initialThreadId, onSendReady, onThreadId,
}: PanelProps) {
  const { messages, isLoading, sendMessage, elapsedMs, threadId, error } =
    useCompareChat(assistant, initialThreadId);
  const { scrollRef, contentRef } = useStickToBottom();

  useEffect(() => { onSendReady(sendMessage); }, [sendMessage, onSendReady]);

  // Propagate threadId up as soon as it's known
  useEffect(() => {
    if (threadId) onThreadId(threadId);
  }, [threadId, onThreadId]);

  // Same processedMessages logic as ChatInterface
  const processedMessages = useMemo(() => {
    const messageMap = new Map<string, { message: Message; toolCalls: ToolCall[] }>();
    messages.forEach((message: Message) => {
      if (message.type === "ai") {
        const raw: Array<{
          id?: string;
          function?: { name?: string; arguments?: unknown };
          name?: string; type?: string; args?: unknown; input?: unknown;
        }> = [];
        if (message.additional_kwargs?.tool_calls && Array.isArray(message.additional_kwargs.tool_calls)) {
          raw.push(...message.additional_kwargs.tool_calls);
        } else if (message.tool_calls && Array.isArray(message.tool_calls)) {
          raw.push(...message.tool_calls.filter((tc: { name?: string }) => tc.name !== ""));
        } else if (Array.isArray(message.content)) {
          raw.push(...message.content.filter((b: { type?: string }) => b.type === "tool_use"));
        }
        const toolCalls: ToolCall[] = raw.map((tc) => ({
          id:     tc.id || `tool-${Math.random()}`,
          name:   tc.function?.name || tc.name || tc.type || "unknown",
          args:   (tc.function?.arguments || tc.args || tc.input || {}) as Record<string, unknown>,
          status: "pending" as const,
        }));
        messageMap.set(message.id!, { message, toolCalls });
      } else if (message.type === "tool") {
        const tcId = (message as any).tool_call_id;
        if (!tcId) return;
        for (const [, data] of messageMap.entries()) {
          const idx = data.toolCalls.findIndex((tc) => tc.id === tcId);
          if (idx === -1) continue;
          data.toolCalls[idx] = {
            ...data.toolCalls[idx],
            status: "completed" as const,
            result: extractStringFromMessageContent(message),
          };
          break;
        }
      } else if (message.type === "human") {
        messageMap.set(message.id!, { message, toolCalls: [] });
      }
    });
    return Array.from(messageMap.values());
  }, [messages]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
      style={{ background: "rgba(13,17,23,0.8)", border: `1px solid ${accent}22` }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${accent}18` }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: accent, boxShadow: `0 0 6px ${accent}99` }} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accent, fontFamily: "var(--font-mono)" }}>
            {label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {elapsedMs != null && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
              <Clock className="h-3 w-3" />
              {(elapsedMs / 1000).toFixed(1)}s
            </span>
          )}
          <TokenMeter messages={messages} isLoading={isLoading} compact />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="space-y-4 p-4" ref={contentRef}>
          {processedMessages.length === 0 && !isLoading && (
            <div
              className="flex items-center justify-center py-12 text-[12px]"
              style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
            >
              waiting for question...
            </div>
          )}
          {processedMessages.map((data) => (
            <ChatMessage
              key={data.message.id}
              message={data.message}
              toolCalls={data.toolCalls}
              isLoading={isLoading}
              graphId={assistant?.graph_id}
            />
          ))}
          {isLoading && (
            <div className="flex gap-1.5 py-2">
              {[0, 1, 2].map((i) => (
                <span key={i} className="loading-dot h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
              ))}
            </div>
          )}
          {error && !isLoading && (
            <div
              className="rounded-lg px-3 py-2 text-[11px]"
              style={{
                background: "rgba(255,79,107,0.08)",
                border: "1px solid rgba(255,79,107,0.25)",
                color: "#FF4F6B",
                fontFamily: "var(--font-mono)",
              }}
            >
              ⚠ Stream hatası: {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Compare inner ────────────────────────────────────────── */
function CompareInner() {
  const client = useClient();
  const [deepAssistant,     setDeepAssistant]     = useState<Assistant | null>(null);
  const [standardAssistant, setStandardAssistant] = useState<Assistant | null>(null);

  const [input, setInput]           = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessions, setSessions]       = useState<CoAgentSession[]>([]);

  // Active session tracking
  const [activeSessionId, setActiveSessionId]       = useState<string | null>(null);
  const [deepInitThread,  setDeepInitThread]         = useState<string | null | undefined>(undefined);
  const [stdInitThread,   setStdInitThread]          = useState<string | null | undefined>(undefined);
  // panelKey is SEPARATE from activeSessionId — only changes on explicit session switch,
  // never on first message send (which would remount panels and kill the stream).
  const [panelKey, setPanelKey] = useState("initial");

  // Collected thread IDs from panels (for saving)
  const pendingDeepThreadId = useRef<string | null>(null);
  const pendingStdThreadId  = useRef<string | null>(null);
  const pendingSessionRef   = useRef<{ id: string; title: string } | null>(null);

  const deepSendRef     = useRef<((t: string) => void) | null>(null);
  const standardSendRef = useRef<((t: string) => void) | null>(null);

  useEffect(() => {
    setSessions(loadSessions());
  }, []);

  useEffect(() => {
    async function loadAssistants() {
      const tryGet = async (graphId: string): Promise<Assistant> => {
        try {
          const list = await client.assistants.search({ graphId, limit: 100 });
          const def = list.find((a) => a.metadata?.["created_by"] === "system");
          return def ?? fallbackAssistant(graphId);
        } catch {
          return fallbackAssistant(graphId);
        }
      };
      const [deep, std] = await Promise.all([tryGet("deep_agent"), tryGet("standard_agent")]);
      setDeepAssistant(deep);
      setStandardAssistant(std);
    }
    loadAssistants();
  }, [client]);

  const fallbackAssistant = (graphId: string): Assistant => ({
    assistant_id: graphId, graph_id: graphId,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    config: {}, metadata: {}, version: 1, name: graphId, context: {},
  });

  const onDeepSendReady     = useCallback((fn: (t: string) => void) => { deepSendRef.current = fn; }, []);
  const onStandardSendReady = useCallback((fn: (t: string) => void) => { standardSendRef.current = fn; }, []);

  const onDeepThreadId = useCallback((id: string) => {
    pendingDeepThreadId.current = id;
    trySaveSession();
  }, []);

  const onStdThreadId = useCallback((id: string) => {
    pendingStdThreadId.current = id;
    trySaveSession();
  }, []);

  function trySaveSession() {
    const meta = pendingSessionRef.current;
    const deepId = pendingDeepThreadId.current;
    const stdId  = pendingStdThreadId.current;
    if (!meta || !deepId || !stdId) return;

    const session: CoAgentSession = {
      id:               meta.id,
      title:            meta.title,
      createdAt:        new Date().toISOString(),
      deepThreadId:     deepId,
      standardThreadId: stdId,
    };
    saveSession(session);
    setSessions(loadSessions());
    pendingSessionRef.current = null;
  }

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    // On the very first message of a new session, prepare session metadata for saving.
    // pendingSessionRef is null only when this is genuinely a fresh unsaved session.
    if (!pendingSessionRef.current && !activeSessionId) {
      const id = `coagent-${Date.now()}`;
      pendingSessionRef.current = { id, title: text.slice(0, 60) };
      pendingDeepThreadId.current = null;
      pendingStdThreadId.current  = null;
      setActiveSessionId(id);  // sidebar highlight only — panelKey is NOT changed here
    }

    deepSendRef.current?.(text);
    standardSendRef.current?.(text);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, activeSessionId]);

  const startNewSession = useCallback(() => {
    setActiveSessionId(null);
    setDeepInitThread(null);
    setStdInitThread(null);
    setPanelKey(`new-${Date.now()}`);
    pendingDeepThreadId.current = null;
    pendingStdThreadId.current  = null;
    pendingSessionRef.current   = null;
  }, []);

  const loadSession = useCallback((session: CoAgentSession) => {
    setActiveSessionId(session.id);
    setDeepInitThread(session.deepThreadId);
    setStdInitThread(session.standardThreadId);
    setPanelKey(session.id);
    pendingDeepThreadId.current = null;
    pendingStdThreadId.current  = null;
    pendingSessionRef.current   = null;
  }, []);

  const handleDeleteSession = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteSession(id);
    setSessions(loadSessions());
    if (activeSessionId === id) startNewSession();
  }, [activeSessionId, startNewSession]);

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 50% 30%, #0A0F14, #060809 80%)" }}
    >
      {/* ── Sidebar ── */}
      <aside
        className={cn(
          "flex flex-col shrink-0 transition-all duration-200",
          sidebarOpen ? "w-[220px]" : "w-0 overflow-hidden",
        )}
        style={{
          background: "rgba(13,17,23,0.97)",
          borderRight: "1px solid var(--bio-border)",
        }}
      >
        {/* Sidebar header */}
        <div className="flex h-12 shrink-0 items-center justify-between px-3" style={{ borderBottom: "1px solid var(--bio-border)" }}>
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "#C4B5FD", fontFamily: "var(--font-mono)" }}>
            Geçmiş
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded p-1 transition-colors"
            style={{ color: "var(--bio-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--bio-text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--bio-muted)")}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* New session button */}
        <div className="px-2 pt-2 pb-1">
          <button
            onClick={startNewSession}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] transition-all"
            style={{
              border: "1px solid rgba(123,79,255,0.3)",
              background: "transparent",
              color: "#C4B5FD",
              fontFamily: "var(--font-mono)",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(123,79,255,0.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Plus className="h-3 w-3" />
            Yeni sohbet
          </button>
        </div>

        {/* Session list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {sessions.length === 0 && (
            <p className="px-2 py-4 text-center text-[10px]" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
              Henüz sohbet yok
            </p>
          )}
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                onClick={() => loadSession(s)}
                className="group relative mb-1 flex cursor-pointer items-start rounded-lg px-2.5 py-2 transition-all"
                style={{
                  background: isActive ? "rgba(123,79,255,0.12)" : "transparent",
                  border: `1px solid ${isActive ? "rgba(123,79,255,0.3)" : "transparent"}`,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[11px] leading-snug"
                    style={{ color: isActive ? "#DDD6FE" : "rgba(232,237,242,0.7)", fontFamily: "var(--font-sans)" }}
                  >
                    {s.title}
                  </p>
                  <p className="mt-0.5 text-[9px]" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
                    {new Date(s.createdAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <button
                  onClick={(e) => handleDeleteSession(e, s.id)}
                  className="ml-1 mt-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "var(--bio-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#FF4F6B")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--bio-muted)")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div
          className="flex h-12 shrink-0 items-center gap-3 px-4"
          style={{ borderBottom: "1px solid var(--bio-border)" }}
        >
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded p-1 transition-colors"
              style={{ color: "var(--bio-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--bio-text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--bio-muted)")}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[11px] transition-colors"
            style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "var(--bio-text)")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "var(--bio-muted)")}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> back
          </Link>
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" style={{ color: "#C4B5FD" }} />
            <span
              className="text-[11px] font-bold uppercase tracking-widest"
              style={{ color: "#C4B5FD", fontFamily: "var(--font-mono)", textShadow: "0 0 12px rgba(123,79,255,0.5)" }}
            >
              Co-Agent Mode
            </span>
          </div>
        </div>

        {/* Column labels */}
        <div className="grid shrink-0 grid-cols-2 gap-4 px-4 pt-3">
          <div className="flex items-center gap-2">
            <span className="h-px flex-1" style={{ background: "rgba(0,255,178,0.2)" }} />
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "#00FFB2", fontFamily: "var(--font-mono)" }}>
              deep agent · hierarchical
            </span>
            <span className="h-px flex-1" style={{ background: "rgba(0,255,178,0.2)" }} />
          </div>
          <div className="flex items-center gap-2">
            <span className="h-px flex-1" style={{ background: "rgba(123,79,255,0.2)" }} />
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "#7B4FFF", fontFamily: "var(--font-mono)" }}>
              standard agent · react loop
            </span>
            <span className="h-px flex-1" style={{ background: "rgba(123,79,255,0.2)" }} />
          </div>
        </div>

        {/* Two panels */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-hidden px-4 py-3">
          <ComparePanel
            key={`deep-${panelKey}`}
            assistant={deepAssistant}
            label="Deep Agent"
            accent="#00FFB2"
            initialThreadId={deepInitThread}
            onSendReady={onDeepSendReady}
            onThreadId={onDeepThreadId}
          />
          <ComparePanel
            key={`std-${panelKey}`}
            assistant={standardAssistant}
            label="Standard Agent"
            accent="#7B4FFF"
            initialThreadId={stdInitThread}
            onSendReady={onStandardSendReady}
            onThreadId={onStdThreadId}
          />
        </div>

        {/* Shared input */}
        <div className="shrink-0 px-4 pb-4">
          <div
            className="rounded-2xl transition-all duration-200"
            style={{
              background: "#0D1117",
              border: inputFocused ? "1px solid rgba(0,255,178,0.45)" : "1px solid rgba(0,255,178,0.18)",
              boxShadow: inputFocused ? "0 0 20px rgba(0,255,178,0.07)" : "none",
            }}
          >
            <div className="flex items-end gap-3 px-4 py-3.5">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="Ask both agents the same question…"
                rows={1}
                style={{
                  flex: 1, resize: "none", overflow: "hidden", maxHeight: "120px",
                  background: "transparent", border: "none", outline: "none", boxShadow: "none",
                  fontFamily: "var(--font-sans)", fontSize: "14px", lineHeight: "1.6",
                  color: "var(--bio-text)", fontStyle: input ? "normal" : "italic",
                }}
              />
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || !deepAssistant || !standardAssistant}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-150"
                style={{
                  background: input.trim() ? "var(--bio-primary)" : "rgba(255,255,255,0.05)",
                  color: input.trim() ? "#080B0F" : "var(--bio-muted)",
                  boxShadow: input.trim() ? "0 0 16px rgba(0,255,178,0.35)" : "none",
                  cursor: !input.trim() ? "not-allowed" : "pointer",
                }}
              >
                <ArrowUp size={14} />
              </button>
            </div>
          </div>
          <p className="mt-2 text-center text-[10px]" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
            ↑ both agents receive the exact same question simultaneously
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Page wrapper ─────────────────────────────────────────── */
function CompareContent() {
  const config: StandaloneConfig = getConfig();
  const langsmithApiKey = config.langsmithApiKey || process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";
  return (
    <ClientProvider deploymentUrl={config.deploymentUrl} apiKey={langsmithApiKey}>
      <CompareInner />
    </ClientProvider>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--bio-bg)" }}>
        <div className="flex gap-2">
          {[0,1,2].map((i) => <span key={i} className="loading-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--bio-primary)" }} />)}
        </div>
      </div>
    }>
      <CompareContent />
    </Suspense>
  );
}
