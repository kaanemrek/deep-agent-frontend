"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useQueryState } from "nuqs";
import { getConfig, saveConfig, StandaloneConfig } from "@/lib/config";
import { ConfigDialog } from "@/app/components/ConfigDialog";
import { Assistant } from "@langchain/langgraph-sdk";
import { ClientProvider, useClient } from "@/providers/ClientProvider";
import { Settings, PanelLeftClose, PanelLeft, Plus, GitCompare } from "lucide-react";
import Link from "next/link";
import { ThreadList } from "@/app/components/ThreadList";
import { ChatProvider } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { AgentSelector, AGENT_OPTIONS } from "@/app/components/AgentSelector";
import { AgentAdvisorModal } from "@/app/components/AgentAdvisorModal";
import { cn } from "@/lib/utils";

function IntroSplash() {
  const [stage, setStage] = useState<"center" | "flying" | "done">("center");
  
  useEffect(() => {
    if (sessionStorage.getItem("ozka-intro-played")) {
      setStage("done");
      return;
    }
    sessionStorage.setItem("ozka-intro-played", "true");
    
    // Stay huge in center for 5s (2 slow heartbeats), then fly to top left for 0.8s
    const t1 = setTimeout(() => setStage("flying"), 5000);
    const t2 = setTimeout(() => setStage("done"), 5800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (stage === "done") return null;

  return (
    <div
      className="fixed inset-0 z-[100000] pointer-events-none"
      style={{
        backdropFilter: stage === "center" ? "blur(20px)" : "blur(0px)",
        background: stage === "center" ? "rgba(8,11,15,0.95)" : "transparent",
        transition: "all 0.8s cubic-bezier(0.76, 0, 0.24, 1)"
      }}
    >
      <style>{`
        @keyframes ozka-heartbeat {
          0% { transform: scale(1); text-shadow: 0 0 60px rgba(0,255,178,0.5); }
          15% { transform: scale(1.08); text-shadow: 0 0 100px rgba(0,255,178,0.9); }
          30% { transform: scale(1); text-shadow: 0 0 60px rgba(0,255,178,0.5); }
          45% { transform: scale(1.08); text-shadow: 0 0 100px rgba(0,255,178,0.9); }
          100% { transform: scale(1); text-shadow: 0 0 60px rgba(0,255,178,0.5); }
        }
      `}</style>
      <div
        className="absolute flex items-center justify-center"
        style={{
          top: stage === "center" ? "50%" : "28px",
          left: stage === "center" ? "50%" : "64px",
          transform: "translate(-50%, -50%)",
          transition: "all 0.8s cubic-bezier(0.76, 0, 0.24, 1)",
        }}
      >
        <div
          style={{
            fontSize: stage === "center" ? "120px" : "22px",
            letterSpacing: stage === "center" ? "0.25em" : "0.18em",
            color: "var(--bio-text)",
            fontFamily: "var(--font-display), sans-serif",
            fontWeight: 900,
            textTransform: "uppercase",
            textShadow: stage === "center" ? "0 0 60px rgba(0,255,178,0.5)" : "0 0 24px rgba(0,255,178,0.25)",
            transition: "all 0.8s cubic-bezier(0.76, 0, 0.24, 1)",
            animation: stage === "center" ? "ozka-heartbeat 2.5s ease-in-out infinite" : "none",
          }}
        >
          OZKA
        </div>
      </div>
    </div>
  );
}

interface HomePageInnerProps {
  config: StandaloneConfig;
  configDialogOpen: boolean;
  setConfigDialogOpen: (open: boolean) => void;
  handleSaveConfig: (config: StandaloneConfig) => void;
}

function HomePageInner({ config, configDialogOpen, setConfigDialogOpen, handleSaveConfig }: HomePageInnerProps) {
  const client = useClient();
  const [, setThreadId] = useQueryState("threadId");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isNewChatMenuOpen, setIsNewChatMenuOpen] = useState(false);

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [interruptCount, setInterruptCount] = useState(0);
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [advisorModalOpen, setAdvisorModalOpen] = useState(false);
  const knownAgentIds = AGENT_OPTIONS.map((o) => o.value) as string[];
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    knownAgentIds.includes(config.assistantId) ? config.assistantId : "deep_agent"
  );

  const handleAgentChange = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    handleSaveConfig({ ...config, assistantId: agentId });
    setThreadId(null);
  }, [setThreadId, config, handleSaveConfig]);

  const fetchAssistant = useCallback(async () => {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedAgentId);
    const fallback = (name: string): Assistant => ({
      assistant_id: selectedAgentId, graph_id: selectedAgentId,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      config: {}, metadata: {}, version: 1, name, context: {},
    });
    if (isUUID) {
      try { setAssistant(await client.assistants.get(selectedAgentId)); }
      catch { setAssistant(fallback("Assistant")); }
    } else {
      try {
        const list = await client.assistants.search({ graphId: selectedAgentId, limit: 100 });
        const def = list.find((a) => a.metadata?.["created_by"] === "system");
        if (!def) throw new Error();
        setAssistant(def);
      } catch { setAssistant(fallback(selectedAgentId)); }
    }
  }, [client, selectedAgentId]);

  useEffect(() => { fetchAssistant(); }, [fetchAssistant]);

  return (
    <>
      <ConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        onSave={handleSaveConfig}
        initialConfig={config}
      />

      {advisorModalOpen && (
        <AgentAdvisorModal
          onClose={() => setAdvisorModalOpen(false)}
          onSelect={(agentId) => { handleAgentChange(agentId); setAdvisorModalOpen(false); }}
        />
      )}

      <div className="flex h-screen overflow-hidden" style={{ background: "var(--bio-bg)" }}>
        <IntroSplash />
        {/* ── Sidebar ───────────────────────────────── */}
        <aside
          className={cn("flex flex-col transition-all duration-200", sidebarOpen ? "w-[260px]" : "w-0 overflow-hidden")}
          style={{
            background: "rgba(13,17,23,0.97)",
            backdropFilter: "blur(20px)",
            borderRight: "1px solid var(--bio-border)",
            flexShrink: 0,
          }}
        >
          {/* Logo row */}
          <div className="flex h-14 shrink-0 items-center justify-between px-4">
            <div className="flex items-center">
              <span
                className="text-[22px] font-black uppercase"
                style={{
                  fontFamily: "var(--font-display), sans-serif",
                  color: "var(--bio-text)",
                  letterSpacing: "0.18em",
                  textShadow: "0 0 24px rgba(0,255,178,0.25)"
                }}
              >
                OZKA
              </span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded-md p-1.5 transition-colors"
              style={{ color: "var(--bio-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--bio-text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--bio-muted)")}
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          {/* New conversation */}
          <div className="px-3 pb-3">
            {!isNewChatMenuOpen ? (
              <button
                onClick={() => setIsNewChatMenuOpen(true)}
                className="group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-2.5 text-left transition-all duration-150"
                style={{
                  border: "1px solid rgba(0,255,178,0.25)",
                  background: "transparent",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "rgba(0,255,178,0.8)",
                  letterSpacing: "0.05em",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.07)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,178,0.4)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,178,0.25)";
                }}
              >
                <Plus className="h-3.5 w-3.5 shrink-0" style={{ filter: "drop-shadow(0 0 4px rgba(0,255,178,0.6))" }} />
                new conversation
                {interruptCount > 0 && (
                  <span
                    className="ml-auto rounded-full px-1.5 py-0.5 text-[9px]"
                    style={{ background: "rgba(255,79,107,0.2)", color: "#FF4F6B", fontFamily: "var(--font-mono)" }}
                  >
                    {interruptCount}
                  </span>
                )}
              </button>
            ) : (
              <div
                className="rounded-xl p-3"
                style={{ border: "1px solid rgba(0,255,178,0.2)", background: "rgba(0,255,178,0.03)" }}
              >
                <p
                  className="mb-2 text-[9px] uppercase tracking-widest"
                  style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
                >
                  choose agent
                </p>
                <AgentSelector
                  value={selectedAgentId}
                  onChange={(id) => { handleAgentChange(id); setIsNewChatMenuOpen(false); }}
                  onNotSure={() => { setAdvisorModalOpen(true); setIsNewChatMenuOpen(false); }}
                />
                <button
                  onClick={() => setIsNewChatMenuOpen(false)}
                  className="mt-2 w-full text-center text-[9px] transition-colors"
                  style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-text)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; }}
                >
                  cancel
                </button>
              </div>
            )}
          </div>

          {/* Thread list */}
          <div className="min-h-0 flex-1">
            <ThreadList
              onThreadSelect={async (thread) => { 
                if (thread.assistantId && thread.assistantId !== selectedAgentId) {
                  setSelectedAgentId(thread.assistantId);
                }
                await setThreadId(thread.id); 
              }}
              onMutateReady={(fn) => setMutateThreads(() => fn)}
              onInterruptCountChange={setInterruptCount}
            />
          </div>

          {/* Footer: settings */}
          <div
            className="shrink-0 space-y-3 p-3"
            style={{ borderTop: "1px solid var(--bio-border)" }}
          >
            <Link
              href="/compare"
              className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-[11px] font-semibold tracking-wide transition-all duration-200"
              style={{
                background: "linear-gradient(135deg, rgba(123,79,255,0.18), rgba(0,255,178,0.1))",
                border: "1px solid rgba(123,79,255,0.4)",
                color: "#C4B5FD",
                fontFamily: "var(--font-mono)",
                boxShadow: "0 0 12px rgba(123,79,255,0.2), inset 0 0 12px rgba(123,79,255,0.05)",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = "linear-gradient(135deg, rgba(123,79,255,0.3), rgba(0,255,178,0.15))";
                el.style.borderColor = "rgba(123,79,255,0.7)";
                el.style.boxShadow = "0 0 22px rgba(123,79,255,0.4), inset 0 0 16px rgba(123,79,255,0.1)";
                el.style.color = "#DDD6FE";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = "linear-gradient(135deg, rgba(123,79,255,0.18), rgba(0,255,178,0.1))";
                el.style.borderColor = "rgba(123,79,255,0.4)";
                el.style.boxShadow = "0 0 12px rgba(123,79,255,0.2), inset 0 0 12px rgba(123,79,255,0.05)";
                el.style.color = "#C4B5FD";
              }}
            >
              {/* Animated shimmer */}
              <span
                className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-700 group-hover:translate-x-full"
              />
              <GitCompare className="h-3.5 w-3.5 shrink-0" />
              Co-Agent Mode
            </Link>
            <button
              onClick={() => setConfigDialogOpen(true)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[11px] transition-colors"
              style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--bio-text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--bio-muted)")}
            >
              <Settings className="h-3.5 w-3.5" />
              settings
            </button>
          </div>
        </aside>

        {/* ── Main area ─────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Collapsed sidebar toggle */}
          {!sidebarOpen && (
            <div
              className="flex h-14 shrink-0 items-center gap-3 px-4"
              style={{ borderBottom: "1px solid var(--bio-border)" }}
            >
              <button
                onClick={() => setSidebarOpen(true)}
                className="rounded-md p-1.5 transition-colors"
                style={{ color: "var(--bio-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--bio-text)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--bio-muted)")}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              <span
                className="text-[14px] font-black uppercase"
                style={{
                  fontFamily: "var(--font-display), sans-serif",
                  color: "var(--bio-text)",
                  letterSpacing: "0.18em",
                  textShadow: "0 0 12px rgba(0,255,178,0.2)"
                }}
              >
                OZKA
              </span>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <ChatProvider activeAssistant={assistant} onHistoryRevalidate={() => mutateThreads?.()}>
              <ChatInterface assistant={assistant} />
            </ChatProvider>
          </div>
        </div>
      </div>
    </>
  );
}

function HomePageContent() {
  const [config, setConfig] = useState<StandaloneConfig>(getConfig());
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [assistantId, setAssistantId] = useQueryState("assistantId");

  useEffect(() => {
    const KNOWN = ["deep_agent", "standard_agent"];
    if (!KNOWN.includes(config.assistantId)) {
      const fixed = { ...config, assistantId: "deep_agent" };
      saveConfig(fixed); setConfig(fixed);
    }
    if (!assistantId) setAssistantId(config.assistantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!assistantId) setAssistantId(config.assistantId);
  }, [config, assistantId, setAssistantId]);

  const handleSaveConfig = useCallback((newConfig: StandaloneConfig) => {
    saveConfig(newConfig); setConfig(newConfig);
  }, []);

  const langsmithApiKey = config.langsmithApiKey || process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  return (
    <ClientProvider deploymentUrl={config.deploymentUrl} apiKey={langsmithApiKey}>
      <HomePageInner
        config={config}
        configDialogOpen={configDialogOpen}
        setConfigDialogOpen={setConfigDialogOpen}
        handleSaveConfig={handleSaveConfig}
      />
    </ClientProvider>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--bio-bg)" }}>
        <div className="flex gap-2">
          {[0,1,2].map((i) => (
            <span key={i} className="loading-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--bio-primary)" }} />
          ))}
        </div>
      </div>
    }>
      <HomePageContent />
    </Suspense>
  );
}
