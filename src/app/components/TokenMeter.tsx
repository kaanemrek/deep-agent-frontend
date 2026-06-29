"use client";

import { useMemo } from "react";
import { Message } from "@langchain/langgraph-sdk";

interface TokenMeterProps {
  messages: Message[];
  isLoading?: boolean;
  compact?: boolean;
}

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

export function TokenMeter({ messages, isLoading, compact }: TokenMeterProps) {
  const { total, perMessage } = useMemo(() => {
    let total = 0;
    const perMessage: number[] = [];
    for (const msg of messages) {
      const usage = (msg as any).usage_metadata;
      const t = usage?.total_tokens ?? 0;
      total += t;
      if (t > 0) perMessage.push(t);
    }
    return { total, perMessage };
  }, [messages]);

  // Context snowball: show the cumulative growth
  const maxContextWarning = total > 100_000;
  const contextLevel = Math.min(total / 200_000, 1); // 0-1 fill

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" title={`${total.toLocaleString()} tokens used`}>
        <div
          className="h-1 w-16 overflow-hidden rounded-full"
          style={{ background: "rgba(255,255,255,0.06)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${contextLevel * 100}%`,
              background: maxContextWarning
                ? "linear-gradient(90deg, #FF4F6B, #FF7B4F)"
                : "linear-gradient(90deg, #00FFB2, #4AFFD4)",
              boxShadow: maxContextWarning
                ? "0 0 6px rgba(255,79,107,0.5)"
                : "0 0 6px rgba(0,255,178,0.4)",
            }}
          />
        </div>
        <span
          className="text-[10px] tabular-nums"
          style={{
            fontFamily: "var(--font-mono)",
            color: maxContextWarning ? "#FF4F6B" : "var(--bio-muted)",
          }}
        >
          {formatK(total)}
        </span>
        {isLoading && (
          <span className="loading-dot h-1 w-1 rounded-full" style={{ background: "var(--bio-primary)" }} />
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "rgba(13,17,23,0.9)",
        border: "1px solid var(--bio-border)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--bio-muted)" }}>
          context usage
        </span>
        <span
          className="text-[12px] font-bold tabular-nums"
          style={{ color: maxContextWarning ? "#FF4F6B" : "var(--bio-primary)" }}
        >
          {total.toLocaleString()} tokens
        </span>
      </div>

      {/* Context growth bar */}
      <div
        className="mb-3 h-2 w-full overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.05)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${contextLevel * 100}%`,
            background: maxContextWarning
              ? "linear-gradient(90deg, #FF4F6B, #FF7B4F)"
              : "linear-gradient(90deg, #00FFB2, #7B4FFF)",
            boxShadow: maxContextWarning
              ? "0 0 8px rgba(255,79,107,0.5)"
              : "0 0 8px rgba(0,255,178,0.3)",
          }}
        />
      </div>

      {maxContextWarning && (
        <p className="text-[10px]" style={{ color: "#FF4F6B" }}>
          ⚠ Context snowball effect — large context may slow responses
        </p>
      )}
    </div>
  );
}
