"use client";

import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const AGENT_OPTIONS = [
  { value: "deep_agent",     label: "Deep Agent" },
  { value: "standard_agent", label: "Standard" },
] as const;

export type AgentId = (typeof AGENT_OPTIONS)[number]["value"];

interface AgentSelectorProps {
  value: string;
  onChange: (value: string) => void;
  onNotSure?: () => void;
}

export function AgentSelector({ value, onChange, onNotSure }: AgentSelectorProps) {
  const activeIndex = AGENT_OPTIONS.findIndex((o) => o.value === value);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Sliding pill toggle */}
      <div
        className="relative flex items-center rounded-full p-0.5"
        style={{
          background: "rgba(13,17,23,0.9)",
          border: "1px solid rgba(0,255,178,0.15)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span
          className="absolute top-0.5 bottom-0.5 rounded-full transition-all"
          style={{
            width: `calc(50% - 2px)`,
            left: activeIndex === 0 ? "2px" : "calc(50%)",
            background: "rgba(0,255,178,0.12)",
            border: "1px solid rgba(0,255,178,0.35)",
            boxShadow: "0 0 10px rgba(0,255,178,0.2)",
            transition: "left 220ms cubic-bezier(0.16,1,0.3,1)",
          }}
        />
        {AGENT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative z-10 flex-1 rounded-full px-3 py-1 text-[10px] uppercase tracking-widest transition-colors duration-150",
              value === opt.value
                ? "text-[#00FFB2]"
                : "text-[#4A5568] hover:text-[#E8EDF2]"
            )}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Not Sure? button */}
      {onNotSure && (
        <button
          type="button"
          onClick={onNotSure}
          className="group relative flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-lg px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-all duration-200"
          style={{
            background: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(251,191,36,0.08))",
            border: "1px solid rgba(245,158,11,0.35)",
            color: "#FCD34D",
            fontFamily: "var(--font-mono)",
            boxShadow: "0 0 10px rgba(245,158,11,0.15), inset 0 0 10px rgba(245,158,11,0.04)",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = "linear-gradient(135deg, rgba(245,158,11,0.25), rgba(251,191,36,0.15))";
            el.style.borderColor = "rgba(245,158,11,0.6)";
            el.style.boxShadow = "0 0 20px rgba(245,158,11,0.3), inset 0 0 14px rgba(245,158,11,0.08)";
            el.style.color = "#FDE68A";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(251,191,36,0.08))";
            el.style.borderColor = "rgba(245,158,11,0.35)";
            el.style.boxShadow = "0 0 10px rgba(245,158,11,0.15), inset 0 0 10px rgba(245,158,11,0.04)";
            el.style.color = "#FCD34D";
          }}
        >
          {/* Shimmer */}
          <span className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          <HelpCircle size={10} />
          Not sure which agent?
        </button>
      )}
    </div>
  );
}
