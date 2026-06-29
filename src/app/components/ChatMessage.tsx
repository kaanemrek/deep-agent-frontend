"use client";

import React, { useMemo, useState, useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { ToolCallBox } from "@/app/components/ToolCallBox";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import type {
  SubAgent,
  ToolCall,
  ActionRequest,
  ReviewConfig,
} from "@/app/types/types";
import { Message } from "@langchain/langgraph-sdk";
import {
  extractSubAgentContent,
  extractStringFromMessageContent,
} from "@/app/utils/utils";
import { cn } from "@/lib/utils";

import { DIAGRAM_PROMPT } from "@/app/components/ChatInterface";

// Matches messages prepended by the repo-pin feature: "Repo path: /some/path\n\nActual question"
const REPO_PATH_RE = /^Repo path:\s*(.+?)\n\n([\s\S]*)$/;

interface ChatMessageProps {
  message: Message;
  toolCalls: ToolCall[];
  isLoading?: boolean;
  actionRequestsMap?: Map<string, ActionRequest>;
  reviewConfigsMap?: Map<string, ReviewConfig>;
  ui?: any[];
  stream?: any;
  onResumeInterrupt?: (value: any) => void;
  graphId?: string;
}

export const ChatMessage = React.memo<ChatMessageProps>(
  ({
    message,
    toolCalls,
    isLoading,
    actionRequestsMap,
    reviewConfigsMap,
    ui,
    stream,
    onResumeInterrupt,
    graphId,
  }) => {
    const isUser = message.type === "human";
    const messageContent = extractStringFromMessageContent(message);
    const hasContent = messageContent && messageContent.trim() !== "";
    const hasToolCalls = toolCalls.length > 0;
    
    const repoMatch = isUser ? messageContent?.match(REPO_PATH_RE) : null;
    const pinnedRepoDisplay = repoMatch ? repoMatch[1] : null;
    const displayContent = (isUser && messageContent === DIAGRAM_PROMPT)
      ? "Creating Mermaid Diagram..."
      : repoMatch
        ? repoMatch[2]
        : messageContent;

    const subAgents = useMemo(() => {
      return toolCalls
        .filter((toolCall: ToolCall) => {
          return (
            toolCall.name === "task" &&
            toolCall.args["subagent_type"] &&
            toolCall.args["subagent_type"] !== "" &&
            toolCall.args["subagent_type"] !== null
          );
        })
        .map((toolCall: ToolCall) => {
          const subagentType = (toolCall.args as Record<string, unknown>)[
            "subagent_type"
          ] as string;
          return {
            id: toolCall.id,
            name: toolCall.name,
            subAgentName: subagentType,
            input: toolCall.args,
            output: toolCall.result ? { result: toolCall.result } : undefined,
            status: toolCall.status,
          } as SubAgent;
        });
    }, [toolCalls]);

    const [expandedSubAgents, setExpandedSubAgents] = useState<
      Record<string, boolean>
    >({});
    const isSubAgentExpanded = useCallback(
      (id: string) => expandedSubAgents[id] ?? true,
      [expandedSubAgents]
    );
    const toggleSubAgent = useCallback((id: string) => {
      setExpandedSubAgents((prev) => ({
        ...prev,
        [id]: prev[id] === undefined ? false : !prev[id],
      }));
    }, []);

    return (
      <div className={cn("msg-appear flex w-full max-w-full overflow-x-hidden", isUser ? "justify-end" : "justify-start")}>
        <div className={cn("min-w-0", isUser ? "max-w-[72%]" : "w-full")}>

          {/* User message — right-aligned pill */}
          {isUser && hasContent && (
            <div className="flex flex-col items-end gap-1">
              {pinnedRepoDisplay && (
                <div
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  style={{
                    background: "rgba(0,255,178,0.06)",
                    border: "1px solid rgba(0,255,178,0.2)",
                    color: "var(--bio-primary)",
                    fontSize: "10px",
                    fontFamily: "var(--font-mono)",
                    maxWidth: "320px",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                  title={pinnedRepoDisplay}
                >
                  <FolderOpen size={10} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {pinnedRepoDisplay}
                  </span>
                </div>
              )}
              <div
                className="rounded-2xl rounded-tr-sm px-4 py-2.5"
                style={{
                  background: "rgba(13,17,23,0.9)",
                  border: "1px solid rgba(0,255,178,0.15)",
                  color: "rgba(232,237,242,0.85)",
                  fontSize: "14px",
                  lineHeight: "1.65",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <p className="m-0 whitespace-pre-wrap break-words">{displayContent}</p>
              </div>
            </div>
          )}

          {/* AI message */}
          {!isUser && (
            <>
              {hasContent && (
                <div
                  className="mt-1 leading-7"
                  style={{ fontSize: "14px", color: "var(--bio-text)", fontFamily: "var(--font-sans)" }}
                >
                  <MarkdownContent content={messageContent} />
                </div>
              )}

              {/* Tool calls */}
              {hasToolCalls && (
                <div className="mt-3 flex flex-col gap-2">
                  {toolCalls.map((toolCall: ToolCall) => {
                    if (toolCall.name === "task") return null;
                    const toolCallGenUiComponent = ui?.find(
                      (u) => u.metadata?.tool_call_id === toolCall.id
                    );
                    const actionRequest = actionRequestsMap?.get(toolCall.name);
                    const reviewConfig = reviewConfigsMap?.get(toolCall.name);
                    return (
                      <ToolCallBox
                        key={toolCall.id}
                        toolCall={toolCall}
                        uiComponent={toolCallGenUiComponent}
                        stream={stream}
                        graphId={graphId}
                        actionRequest={actionRequest}
                        reviewConfig={reviewConfig}
                        onResume={onResumeInterrupt}
                        isLoading={isLoading}
                      />
                    );
                  })}
                </div>
              )}

              {/* Sub-agent tree */}
              {subAgents.length > 0 && (
                <div className="mt-4">
                  {/* Tree header */}
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="text-[9px] uppercase tracking-widest"
                      style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
                    >
                      sub-agent tree
                    </span>
                    <span className="h-px flex-1" style={{ background: "var(--bio-border)" }} />
                    <span
                      className="text-[9px]"
                      style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
                    >
                      {subAgents.filter((s) => s.status === "completed").length}/{subAgents.length}
                    </span>
                  </div>

                  {/* Root node */}
                  <div className="relative pl-4">
                    <div
                      className="absolute left-0 top-0 bottom-0 w-px"
                      style={{ background: "rgba(0,255,178,0.15)" }}
                    />

                    {subAgents.map((subAgent) => {
                      const isDone     = subAgent.status === "completed";
                      const isRunning  = subAgent.status === "pending" && isLoading;
                      const isExpanded = isSubAgentExpanded(subAgent.id);

                      return (
                        <div key={subAgent.id} className="relative mb-1.5 last:mb-0">
                          {/* Connector line */}
                          <div
                            className="absolute -left-4 top-3.5 h-px w-4"
                            style={{ background: "rgba(0,255,178,0.15)" }}
                          />

                          {/* Node */}
                          <button
                            type="button"
                            onClick={() => toggleSubAgent(subAgent.id)}
                            className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-all duration-150"
                            style={{
                              background: isExpanded ? "rgba(0,255,178,0.04)" : "transparent",
                              border: `1px solid ${isExpanded ? "rgba(0,255,178,0.12)" : "transparent"}`,
                            }}
                          >
                            {/* Status dot */}
                            <span className="relative mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center">
                              {isRunning ? (
                                <>
                                  <span className="absolute inset-0 rounded-full" style={{ background: "var(--bio-primary)", animation: "bio-ping 1.5s ease-out infinite", opacity: 0.5 }} />
                                  <span className="relative h-2 w-2 rounded-full" style={{ background: "var(--bio-primary)" }} />
                                </>
                              ) : isDone ? (
                                <span className="h-2 w-2 rounded-full" style={{ background: "var(--bio-primary)", opacity: 0.7 }} />
                              ) : (
                                <span className="h-2 w-2 rounded-full" style={{ background: "var(--bio-muted)", opacity: 0.4 }} />
                              )}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className="text-[11px] font-medium"
                                  style={{ color: isDone ? "rgba(232,237,242,0.8)" : "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
                                >
                                  {subAgent.subAgentName || "code-explorer"}
                                </span>
                                <span
                                  className="rounded px-1.5 py-0.5 text-[9px] uppercase"
                                  style={{
                                    background: isDone ? "rgba(0,255,178,0.08)" : isRunning ? "rgba(0,255,178,0.15)" : "rgba(255,255,255,0.04)",
                                    color: isDone ? "var(--bio-primary)" : isRunning ? "var(--bio-primary)" : "var(--bio-muted)",
                                    fontFamily: "var(--font-mono)",
                                  }}
                                >
                                  {isDone ? "done" : isRunning ? "running" : "pending"}
                                </span>
                              </div>
                            </div>
                            <span style={{ color: "var(--bio-muted)", fontSize: "10px" }}>
                              {isExpanded ? "▲" : "▼"}
                            </span>
                          </button>

                          {/* Expanded detail */}
                          {isExpanded && (
                            <div
                              className="mx-1 mb-2 rounded-lg p-3"
                              style={{
                                background: "rgba(8,11,15,0.8)",
                                border: "1px solid rgba(0,255,178,0.08)",
                                marginLeft: "20px",
                              }}
                            >
                              <p className="mb-1.5 text-[9px] uppercase tracking-widest" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>input</p>
                              <div className="mb-2 text-[12px]" style={{ color: "rgba(232,237,242,0.7)" }}>
                                <MarkdownContent content={extractSubAgentContent(subAgent.input)} />
                              </div>
                              {subAgent.output && (
                                <>
                                  <p className="mb-1.5 text-[9px] uppercase tracking-widest" style={{ color: "var(--bio-primary)", fontFamily: "var(--font-mono)", opacity: 0.7 }}>output</p>
                                  <div className="text-[12px]" style={{ color: "rgba(232,237,242,0.7)" }}>
                                    <MarkdownContent content={extractSubAgentContent(subAgent.output)} />
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
);

ChatMessage.displayName = "ChatMessage";
