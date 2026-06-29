"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronRight, RotateCcw, FolderOpen, Loader2 } from "lucide-react";
import { useClient } from "@/providers/ClientProvider";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Option {
  label: string;
  hint?: string;
  weights: { deep: number; standard: number };
}
interface Question {
  id: string;
  text: string;
  options: Option[];
}
interface AdvisorResult {
  deep_pct: number;
  standard_pct: number;
  winner: "deep" | "standard";
  reasons: string[];
}

// ── Questions ──────────────────────────────────────────────────────────────────
const QUESTIONS: Question[] = [
  {
    id: "repo_size",
    text: "How large is the codebase you want to explore?",
    options: [
      { label: "Small",  hint: "< 10k lines, simple lib",    weights: { deep: 3, standard: 8 } },
      { label: "Medium", hint: "10k–100k lines",             weights: { deep: 6, standard: 6 } },
      { label: "Large",  hint: "> 100k lines, monorepo",     weights: { deep: 9, standard: 3 } },
    ],
  },
  {
    id: "question_type",
    text: "What kind of questions will you mainly ask?",
    options: [
      { label: "Simple lookups",    hint: "\"Where is X defined?\"",      weights: { deep: 3, standard: 9 } },
      { label: "Architecture",      hint: "Module relationships & design", weights: { deep: 8, standard: 5 } },
      { label: "Deep code tracing", hint: "Multi-file execution flows",    weights: { deep: 9, standard: 3 } },
    ],
  },
  {
    id: "speed",
    text: "What matters more to you right now?",
    options: [
      { label: "Speed",   hint: "Fast answers, lower cost",     weights: { deep: 2, standard: 9 } },
      { label: "Balance", hint: "Reasonable quality & speed",   weights: { deep: 5, standard: 7 } },
      { label: "Depth",   hint: "Thorough analysis over speed", weights: { deep: 9, standard: 4 } },
    ],
  },
  {
    id: "tracing",
    text: "Do you need to see the agent's reasoning steps?",
    options: [
      { label: "No, just the answer",     hint: "",                          weights: { deep: 4, standard: 8 } },
      { label: "Nice to have",            hint: "",                          weights: { deep: 6, standard: 6 } },
      { label: "Yes, I want full traces", hint: "Sub-agent logs, TODO list", weights: { deep: 9, standard: 3 } },
    ],
  },
];

// Step layout:  0 = repo path · 1..activeQuestions.length = questions · > = result
// When repo is provided, skip "repo_size" — the AI can infer it from the path.

// ── Fallback static scoring (used when AI call fails) ──────────────────────────
function staticScores(answers: Record<string, Option>): AdvisorResult {
  const vals = Object.values(answers);
  if (!vals.length) return { deep_pct: 50, standard_pct: 50, winner: "deep", reasons: [] };
  const deepSum     = vals.reduce((s, o) => s + o.weights.deep,     0);
  const standardSum = vals.reduce((s, o) => s + o.weights.standard, 0);
  const total       = deepSum + standardSum;
  const deep_pct    = Math.round((deepSum     / total) * 100);
  const standard_pct = Math.round((standardSum / total) * 100);
  const winner: "deep" | "standard" = deep_pct >= standard_pct ? "deep" : "standard";

  const reasons: string[] = [];
  const size  = answers["repo_size"];
  const qtype = answers["question_type"];
  const speed = answers["speed"];
  const trace = answers["tracing"];
  if (winner === "deep") {
    if (size?.weights.deep   >= 7) reasons.push("Large codebases need Deep Agent's autonomous file-tree navigation.");
    if (qtype?.weights.deep  >= 7) reasons.push("Architecture & tracing questions benefit from hierarchical sub-agent search.");
    if (speed?.weights.deep  >= 7) reasons.push("You prioritize depth — Deep Agent's exhaustive approach suits this.");
    if (trace?.weights.deep  >= 7) reasons.push("Full reasoning traces are a core feature of Deep Agent's TODO + sub-agent flow.");
  } else {
    if (size?.weights.standard  >= 7) reasons.push("Small repos are well-served by targeted keyword search without orchestration overhead.");
    if (qtype?.weights.standard >= 7) reasons.push("Simple lookups are answered faster with Standard Agent's direct RAG approach.");
    if (speed?.weights.standard >= 7) reasons.push("Speed is your priority — Standard Agent skips sub-agent overhead.");
    if (trace?.weights.standard >= 7) reasons.push("You just want the answer — Standard Agent's concise output suits your workflow.");
  }
  if (!reasons.length) reasons.push("Both agents are suitable; slight edge from your answers.");
  return { deep_pct, standard_pct, winner, reasons };
}

// ── Build the prompt sent to the advisor LLM ──────────────────────────────────
function buildPrompt(repoPath: string, answers: Record<string, Option>): string {
  const lines: string[] = [];
  lines.push(`Repo: ${repoPath || "Not provided"}`);
  lines.push("");
  lines.push("User context:");
  if (answers.repo_size)    lines.push(`- Codebase size: ${answers.repo_size.label}${answers.repo_size.hint ? ` (${answers.repo_size.hint})` : ""}`);
  if (answers.question_type) lines.push(`- Main question types: ${answers.question_type.label}${answers.question_type.hint ? ` (${answers.question_type.hint})` : ""}`);
  if (answers.speed)        lines.push(`- Priority: ${answers.speed.label}${answers.speed.hint ? ` (${answers.speed.hint})` : ""}`);
  if (answers.tracing)      lines.push(`- Wants reasoning traces: ${answers.tracing.label}`);
  return lines.join("\n");
}

// ── Modal ──────────────────────────────────────────────────────────────────────
interface AgentAdvisorModalProps {
  onClose: () => void;
  onSelect: (agentId: "deep_agent" | "standard_agent") => void;
}

export function AgentAdvisorModal({ onClose, onSelect }: AgentAdvisorModalProps) {
  const client = useClient();

  const [step, setStep]       = useState(0);
  const [repoPath, setRepoPath] = useState("");
  const [answers, setAnswers]  = useState<Record<string, Option>>({});
  const [mounted, setMounted]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // AI result state
  const [aiResult, setAiResult]   = useState<AdvisorResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFailed, setAiFailed]   = useState(false);

  // When repo is provided, skip the size question — AI can infer it from the path
  const activeQuestions = repoPath
    ? QUESTIONS.filter((q) => q.id !== "repo_size")
    : QUESTIONS;
  const totalSteps = 1 + activeQuestions.length; // 1 for repo step

  const isRepoStep     = step === 0;
  const isQuestionStep = step >= 1 && step <= activeQuestions.length;
  const isResult       = step > activeQuestions.length;
  const currentQ       = isQuestionStep ? activeQuestions[step - 1] : null;

  // Display: prefer AI result, fallback to static
  const display: AdvisorResult = aiResult ?? staticScores(answers);
  const winnerId    = display.winner === "deep" ? "deep_agent" : "standard_agent";
  const winnerLabel = display.winner === "deep" ? "Deep Agent" : "Standard Agent";
  const loserLabel  = display.winner === "deep" ? "Standard Agent" : "Deep Agent";

  useEffect(() => {
    setMounted(true);
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (mounted && step === 0) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [mounted, step]);

  // Trigger AI analysis when result step is reached
  useEffect(() => {
    if (!isResult) return;
    setAiLoading(true);
    setAiFailed(false);

    const prompt = buildPrompt(repoPath, answers);

    (async () => {
      try {
        const thread = await client.threads.create();
        let lastContent = "";

        for await (const chunk of client.runs.stream(thread.thread_id, "advisor", {
          input: { messages: [{ role: "human", content: prompt }] },
          streamMode: "values",
        })) {
          if (chunk.event === "values") {
            const data = chunk.data as Record<string, unknown>;
            const msgs = (data?.messages as Array<{ type: string; content: string | Array<{ text: string }> }>) || [];
            const lastAI = [...msgs].reverse().find((m) => m.type === "ai");
            if (lastAI) {
              const content = typeof lastAI.content === "string"
                ? lastAI.content
                : lastAI.content.map((c) => c.text ?? "").join("");
              if (content) lastContent = content;
            }
          }
        }

        if (!lastContent) throw new Error("empty response");

        // Extract JSON — model is instructed to return only JSON but may wrap it
        const jsonMatch = lastContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("no JSON in response");

        const parsed = JSON.parse(jsonMatch[0]) as AdvisorResult;
        // Normalise just in case
        const total = (parsed.deep_pct ?? 0) + (parsed.standard_pct ?? 0);
        if (total !== 100) {
          parsed.deep_pct     = Math.round((parsed.deep_pct / total) * 100);
          parsed.standard_pct = 100 - parsed.deep_pct;
        }
        parsed.winner = parsed.deep_pct >= parsed.standard_pct ? "deep" : "standard";
        setAiResult(parsed);
      } catch (err) {
        console.error("[AgentAdvisor] AI call failed, using static scores:", err);
        setAiFailed(true);
      } finally {
        setAiLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResult]);

  const advanceFromRepo = () => setStep(1);

  const choose = (opt: Option) => {
    const next = { ...answers, [currentQ!.id]: opt };
    setAnswers(next);
    setStep((s) => s + 1);
  };

  const reset = () => {
    setStep(0);
    setAnswers({});
    setRepoPath("");
    setAiResult(null);
    setAiLoading(false);
    setAiFailed(false);
  };

  if (!mounted) return null;

  const progressPct = isResult ? 100 : Math.round((step / totalSteps) * 100);

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col overflow-hidden rounded-2xl"
        style={{
          width: "75vw",
          maxWidth: "700px",
          background: "rgba(8,11,15,0.98)",
          border: "1px solid rgba(0,255,178,0.18)",
          boxShadow: "0 0 60px rgba(0,255,178,0.07)",
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid rgba(0,255,178,0.08)" }}
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--bio-primary)", fontFamily: "var(--font-mono)", marginBottom: 2 }}>
              agent advisor
            </p>
            {!isResult && (
              <p className="text-[11px]" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
                {isRepoStep ? "repo context (optional)" : `question ${step} / ${activeQuestions.length}${repoPath ? " · repo provided" : ""}`}
              </p>
            )}
            {isResult && aiLoading && (
              <p className="text-[11px]" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
                analyzing with AI…
              </p>
            )}
            {isResult && !aiLoading && aiFailed && (
              <p className="text-[11px]" style={{ color: "rgba(245,158,11,0.7)", fontFamily: "var(--font-mono)" }}>
                using estimated scores
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
            style={{ color: "var(--bio-muted)", background: "rgba(255,255,255,0.04)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-text)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        {!isResult && (
          <div className="h-0.5 w-full" style={{ background: "rgba(0,255,178,0.06)" }}>
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${progressPct}%`,
                background: "linear-gradient(90deg, rgba(0,255,178,0.4), rgba(0,255,178,0.7))",
              }}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-8">

          {/* ── Step 0: Repo path ── */}
          {isRepoStep && (
            <div style={{ animation: "type-reveal 0.3s ease both" }}>
              <p className="mb-2 text-[18px] font-semibold leading-snug" style={{ color: "var(--bio-text)", fontFamily: "var(--font-display)" }}>
                What repo are you working with?
              </p>
              <p className="mb-6 text-[13px]" style={{ color: "var(--bio-muted)" }}>
                Providing a path or URL lets the AI tailor its recommendation. You can skip this.
              </p>
              <div
                className="mb-6 flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: "rgba(0,255,178,0.03)", border: "1px solid rgba(0,255,178,0.15)" }}
              >
                <FolderOpen size={16} style={{ color: "var(--bio-muted)", flexShrink: 0 }} />
                <input
                  ref={inputRef}
                  type="text"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") advanceFromRepo(); }}
                  placeholder="/Users/you/projects/my-repo  or  https://github.com/…"
                  style={{
                    flex: 1, background: "transparent", border: "none", outline: "none",
                    fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--bio-text)",
                  }}
                />
              </div>
              <button
                onClick={advanceFromRepo}
                className="w-full rounded-xl py-3 text-[13px] font-semibold transition-all duration-150"
                style={{
                  background: repoPath ? "var(--bio-primary)" : "rgba(0,255,178,0.08)",
                  color: repoPath ? "#080B0F" : "var(--bio-primary)",
                  fontFamily: "var(--font-mono)",
                  border: "1px solid rgba(0,255,178,0.3)",
                  boxShadow: repoPath ? "0 0 20px rgba(0,255,178,0.25)" : "none",
                }}
              >
                {repoPath ? "Continue →" : "Skip, answer questions →"}
              </button>
            </div>
          )}

          {/* ── Steps 1-N: Questions ── */}
          {isQuestionStep && currentQ && (
            <div key={currentQ.id} style={{ animation: "type-reveal 0.3s ease both" }}>
              <p className="mb-6 text-[18px] font-semibold leading-snug" style={{ color: "var(--bio-text)", fontFamily: "var(--font-display)" }}>
                {currentQ.text}
              </p>
              <div className="flex flex-col gap-3">
                {currentQ.options.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => choose(opt)}
                    className="group flex items-center justify-between rounded-xl px-5 py-4 text-left transition-all duration-150"
                    style={{ border: "1px solid rgba(0,255,178,0.12)", background: "rgba(0,255,178,0.03)" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background  = "rgba(0,255,178,0.08)";
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,178,0.3)";
                      (e.currentTarget as HTMLElement).style.transform   = "translateX(4px)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background  = "rgba(0,255,178,0.03)";
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,178,0.12)";
                      (e.currentTarget as HTMLElement).style.transform   = "translateX(0)";
                    }}
                  >
                    <div>
                      <p className="text-[14px] font-medium" style={{ color: "var(--bio-text)" }}>{opt.label}</p>
                      {opt.hint && (
                        <p className="mt-0.5 text-[11px]" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>{opt.hint}</p>
                      )}
                    </div>
                    <ChevronRight size={16} style={{ color: "var(--bio-muted)", flexShrink: 0 }} className="transition-transform group-hover:translate-x-1" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Result ── */}
          {isResult && (
            <div style={{ animation: "type-reveal 0.4s ease both" }}>

              {/* Loading state */}
              {aiLoading && (
                <div className="flex flex-col items-center justify-center gap-4 py-12">
                  <Loader2 size={28} className="animate-spin" style={{ color: "var(--bio-primary)" }} />
                  <p className="text-[13px]" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
                    AI is analyzing your context…
                  </p>
                </div>
              )}

              {/* Result content */}
              {!aiLoading && (
                <>
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}>
                      recommendation
                    </p>
                    {!aiFailed && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] uppercase tracking-widest"
                        style={{ background: "rgba(0,255,178,0.1)", color: "var(--bio-primary)", fontFamily: "var(--font-mono)", border: "1px solid rgba(0,255,178,0.2)" }}
                      >
                        AI scored
                      </span>
                    )}
                  </div>
                  <p className="mb-6 text-[22px] font-bold" style={{ color: "var(--bio-primary)", fontFamily: "var(--font-display)" }}>
                    {winnerLabel}
                  </p>

                  {/* Score bars */}
                  <div className="mb-6 space-y-3">
                    {[
                      { label: "Deep Agent",     pct: display.deep_pct,     isWinner: display.winner === "deep" },
                      { label: "Standard Agent", pct: display.standard_pct, isWinner: display.winner === "standard" },
                    ].map(({ label, pct, isWinner }) => (
                      <div key={label}>
                        <div className="mb-1 flex justify-between text-[11px]" style={{ fontFamily: "var(--font-mono)" }}>
                          <span style={{ color: isWinner ? "var(--bio-primary)" : "var(--bio-muted)" }}>{label}</span>
                          <span style={{ color: isWinner ? "var(--bio-primary)" : "var(--bio-muted)" }}>{pct}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${pct}%`,
                              background: isWinner
                                ? "linear-gradient(90deg, rgba(0,255,178,0.6), rgba(0,255,178,0.9))"
                                : "rgba(255,255,255,0.12)",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Reasoning */}
                  {display.reasons.length > 0 && (
                    <div
                      className="mb-6 rounded-xl p-4"
                      style={{ background: "rgba(0,255,178,0.03)", border: "1px solid rgba(0,255,178,0.1)" }}
                    >
                      <p className="mb-3 text-[10px] uppercase tracking-widest" style={{ color: "var(--bio-primary)", fontFamily: "var(--font-mono)" }}>
                        why {winnerLabel}?
                      </p>
                      <ul className="space-y-2">
                        {display.reasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-[13px]" style={{ color: "rgba(232,237,242,0.8)" }}>
                            <span style={{ color: "var(--bio-primary)", marginTop: 2, flexShrink: 0 }}>→</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => { onSelect(winnerId); onClose(); }}
                      className="flex-1 rounded-xl py-3 text-[13px] font-semibold transition-all duration-150"
                      style={{
                        background: "var(--bio-primary)", color: "#080B0F",
                        fontFamily: "var(--font-mono)", boxShadow: "0 0 20px rgba(0,255,178,0.3)",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 0 30px rgba(0,255,178,0.45)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(0,255,178,0.3)"; }}
                    >
                      Use {winnerLabel}
                    </button>
                    <button
                      onClick={() => { onSelect(winnerId === "deep_agent" ? "standard_agent" : "deep_agent"); onClose(); }}
                      className="rounded-xl px-5 py-3 text-[13px] transition-all duration-150"
                      style={{ border: "1px solid rgba(0,255,178,0.2)", background: "transparent", color: "var(--bio-muted)", fontFamily: "var(--font-mono)" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-text)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,178,0.4)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,178,0.2)"; }}
                    >
                      Use {loserLabel} anyway
                    </button>
                    <button
                      onClick={reset}
                      className="flex h-11 w-11 items-center justify-center rounded-xl transition-all"
                      title="Start over"
                      style={{ border: "1px solid rgba(255,255,255,0.07)", color: "var(--bio-muted)" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-text)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; }}
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
