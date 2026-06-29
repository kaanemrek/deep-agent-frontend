"use client";

import React, {
  useEffect, useRef, useState, useId, useCallback, useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { Download, Maximize2, X, ChevronDown, ChevronUp, ZoomIn, ZoomOut, RefreshCw } from "lucide-react";

// ── Sanitizer ─────────────────────────────────────────────────────────────────
// LLM-generated Mermaid frequently has issues with special chars in various
// positions. We build progressive passes and try each in order until one renders.

function attempts(raw: string): string[] {
  // normalise line endings
  const p0 = raw.trim().replace(/\r\n?/g, "\n");

  // helpers ─────────────────────────────────────────────────────────────────
  // Strip chars that break the Mermaid parser inside edge labels |...|
  const cleanEdge = (s: string) =>
    s.replace(/[()[\]{}<>"]/g, "")
     .replace(/&/g, "and")
     .replace(/\s+/g, " ")
     .trim();

  // Strip chars that break the Mermaid parser inside bracket node labels [...]
  const cleanBracket = (s: string) =>
    s.replace(/"/g, "'")
     .replace(/[<>]/g, "")
     .replace(/&/g, "and");

  // Strip parens and angle brackets from subgraph names
  const cleanSubgraph = (s: string) =>
    s.replace(/[()[\]{}<>]/g, "")
     .replace(/&/g, "and")
     .replace(/\s+/g, " ")
     .trim();

  // Sanitise content inside `note for ClassName "..."` blocks.
  // * triggers the abstract-method parser even inside quoted strings in classDiagram.
  const cleanNote = (s: string) =>
    s.replace(/\*/g, "·")          // * → middle-dot (safe multiplication symbol)
     .replace(/\[/g, "(")          // [ → ( avoids type-annotation parser conflict
     .replace(/\]/g, ")");         // ] → matching close

  // Pass 1 – remove markdown bold/italic (**…**, *…*)
  const p1 = p0
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");

  // Pass 1b – sanitise `note for` content in classDiagram
  //   Matches:  note for ClassName "content"
  const p1b = p1.replace(
    /^([ \t]*note[ \t]+for[ \t]+\S+[ \t]+)"([^"]+)"/gm,
    (_, prefix, content) => `${prefix}"${cleanNote(content)}"`,
  );

  // Pass 1c – fix mismatched brackets in attribute values:  [1, oo)  →  (1, oo)
  //   Mermaid sees [ as the start of a type annotation; when it closes with )
  //   instead of ] the parser throws. Convert to plain parentheses.
  const p1c = p1b.replace(/\[([^\]\n]*)\)/g, (_, inner) => `(${inner})`);

  // Pass 2 – sanitise edge labels  -->|label|  and  ---|label|
  const p2 = p1c.replace(/\|([^|\n]+)\|/g, (_, inner) => `|${cleanEdge(inner)}|`);

  // Pass 3 – sanitise bracket node labels  [Label text]
  const p3 = p2.replace(/\[([^\]\n]+)\]/g, (_, inner) => `[${cleanBracket(inner)}]`);

  // Pass 4 – sanitise quoted subgraph names  subgraph "Name (with parens)"
  const p4 = p3.replace(
    /^([ \t]*subgraph[ \t]+)"([^"\n]+)"/gm,
    (_, prefix, name) => `${prefix}"${cleanSubgraph(name)}"`,
  );

  // Pass 4b – sanitise UNQUOTED subgraph names with parens/brackets
  //   e.g.  subgraph Python Backend (Developer Source)
  //     →   subgraph "Python Backend Developer Source"
  //   Only triggers when the name (no leading ") contains () [] {} <>
  const p4b = p4.replace(
    /^([ \t]*subgraph[ \t]+)(?!")([^[\n]+)$/gm,
    (match, prefix, name) =>
      /[()[\]{}<>]/.test(name)
        ? `${prefix}"${cleanSubgraph(name)}"`
        : match,
  );

  // Pass 5 – remove 'create participant' lines (sequence diagram conflict)
  const p5 = p4b.replace(/^[ \t]*create participant[ \t]+.*$/gm, "");

  // Pass 6 – replace __double_underscores__ in labels with single underscore
  //          (prevents accidental Mermaid markdown-bold interpretation)
  const p6 = p5
    .replace(/\[([^\]\n]+)\]/g, (_, inner) => `[${inner.replace(/__/g, "_")}]`)
    .replace(/\|([^|\n]+)\|/g, (_, inner) => `|${inner.replace(/__/g, "_")}|`);

  // Pass 7 – nuclear: strip ALL remaining non-safe characters from labels
  //          Safe set: letters, digits, spaces, . _ - , : / ' ( )
  const nukeBracket = (s: string) => s.replace(/[^\w\s.,\-:/'()]/g, "");
  const nukeEdge    = (s: string) => s.replace(/[^\w\s.,\-:/']/g, "");
  const p7 = p6
    .replace(/\[([^\]\n]+)\]/g, (_, inner) => `[${nukeBracket(inner)}]`)
    .replace(/\|([^|\n]+)\|/g,   (_, inner) => `|${nukeEdge(inner)}|`)
    .replace(/^([ \t]*subgraph[ \t]+)"([^"\n]+)"/gm,
      (_, prefix, name) => `${prefix}"${name.replace(/[^\w\s\-]/g, "")}"`,
    );

  return [...new Set([p0, p1, p2, p3, p4, p5, p6, p7])];
}

// ── Download SVG→PNG ───────────────────────────────────────────────────────────
function downloadPng(container: HTMLElement | null) {
  if (!container) return;
  const svgEl = container.querySelector("svg");
  if (!svgEl) return;

  const w = svgEl.getBoundingClientRect().width || 900;
  const h = svgEl.getBoundingClientRect().height || 600;
  const scale = 2;

  const serializer = new XMLSerializer();
  // inline font so it renders correctly in canvas
  const svgStr = `<?xml version="1.0" encoding="UTF-8"?>` + serializer.serializeToString(svgEl);
  const base64 = btoa(unescape(encodeURIComponent(svgStr)));
  const url = `data:image/svg+xml;base64,${base64}`;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const a = document.createElement("a");
    try {
      a.download = "architecture-diagram.png";
      a.href = canvas.toDataURL("image/png");
    } catch (err) {
      console.warn("Canvas tainted, falling back to SVG download", err);
      a.download = "architecture-diagram.svg";
      a.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
    }
    a.click();
  };
  img.onerror = () => {
    console.warn("Image load failed, falling back to SVG download");
    const a = document.createElement("a");
    a.download = "architecture-diagram.svg";
    a.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
    a.click();
  };
  img.src = url;
}

// ── Modal ──────────────────────────────────────────────────────────────────────
interface DiagramModalProps {
  svg: string;
  onClose: () => void;
  onDownload: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function DiagramModal({ svg, onClose, onDownload, containerRef }: DiagramModalProps) {
  const [mounted, setMounted] = useState(false);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // close on Escape
  useEffect(() => {
    setMounted(true);
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleWheel = (e: React.WheelEvent) => {
    const scaleChange = e.deltaY * -0.001;
    const newScale = Math.min(Math.max(0.1, scale * (1 + scaleChange)), 5);
    setScale(newScale);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col overflow-hidden rounded-2xl"
        style={{
          width: "75vw",
          height: "75vh",
          background: "rgba(8,11,15,0.98)",
          border: "1px solid rgba(0,255,178,0.18)",
          boxShadow: "0 0 60px rgba(0,255,178,0.08)",
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-5 py-3"
          style={{ borderBottom: "1px solid rgba(0,255,178,0.1)" }}
        >
          <span
            className="text-[10px] uppercase tracking-widest"
            style={{ color: "var(--bio-primary)", fontFamily: "var(--font-mono)" }}
          >
            architecture diagram
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onDownload}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] transition-all"
              style={{
                background: "rgba(0,255,178,0.08)",
                border: "1px solid rgba(0,255,178,0.2)",
                color: "var(--bio-primary)",
                fontFamily: "var(--font-mono)",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.15)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.08)"; }}
            >
              <Download size={12} />
              download png
            </button>
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
        </div>

        <div className="absolute bottom-6 right-6 z-10 flex flex-col gap-2 rounded-xl p-1.5" style={{ background: "rgba(13,17,23,0.8)", border: "1px solid rgba(0,255,178,0.15)", backdropFilter: "blur(4px)" }}>
          <button onClick={() => setScale(s => Math.min(s * 1.2, 5))} className="flex h-8 w-8 items-center justify-center rounded-lg transition-all" style={{ color: "var(--bio-muted)" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-primary)"; (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.1)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <ZoomIn size={16} />
          </button>
          <button onClick={() => { setScale(1); setPosition({x:0, y:0}); }} className="flex h-8 w-8 items-center justify-center rounded-lg transition-all" style={{ color: "var(--bio-muted)" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-primary)"; (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.1)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setScale(s => Math.max(s / 1.2, 0.1))} className="flex h-8 w-8 items-center justify-center rounded-lg transition-all" style={{ color: "var(--bio-muted)" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-primary)"; (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.1)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <ZoomOut size={16} />
          </button>
        </div>

        <div
          ref={containerRef}
          className="flex-1 overflow-hidden cursor-move"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            className="w-full h-full flex items-center justify-center p-6"
            dangerouslySetInnerHTML={{ __html: svg }}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: "center center",
              transition: isDragging ? "none" : "transform 0.1s ease-out",
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
interface MermaidDiagramProps { code: string; }

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ code }) => {
  const thumbRef   = useRef<HTMLDivElement>(null);
  const modalRef   = useRef<HTMLDivElement>(null);
  const [svg, setSvg]             = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);

    const render = async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: "dark",
        themeVariables: {
          background:             "#0d1117",
          primaryColor:           "#00FFB2",
          primaryTextColor:       "#E8EDF2",
          primaryBorderColor:     "rgba(0,255,178,0.3)",
          lineColor:              "rgba(0,255,178,0.5)",
          secondaryColor:         "#161b22",
          tertiaryColor:          "#21262d",
          edgeLabelBackground:    "rgba(13,17,23,0.9)",
          clusterBkg:             "#161b22",
          titleColor:             "#E8EDF2",
          fontFamily:             "ui-monospace, monospace",
          fontSize:               "13px",
          nodeBorder:             "rgba(0,255,178,0.3)",
          mainBkg:                "#161b22",
        },
        themeCSS: `
          /* Override absurd LLM colors (pink, white) to match dark theme */
          .node rect, .node circle, .node ellipse, .node polygon, .node path {
            fill: #161b22 !important;
            stroke: rgba(0,255,178,0.4) !important;
            stroke-width: 1px !important;
          }
          .cluster rect {
            fill: rgba(22, 27, 34, 0.5) !important;
            stroke: rgba(0,255,178,0.2) !important;
            stroke-width: 1px !important;
          }
          /* Ensure all text is bright and readable against the dark backgrounds */
          .node text, .edgeLabel text, .cluster-label text {
            fill: #E8EDF2 !important;
            font-weight: 500 !important;
          }
        `,
        securityLevel: "loose",
        flowchart: { useMaxWidth: true, htmlLabels: false },
      });

      for (const variant of attempts(code)) {
        try {
          const { svg: rendered } = await mermaid.render(`mermaid-${uid}`, variant);
          if (!cancelled) { setSvg(rendered); setError(null); }
          return;
        } catch (_) {
          // try next variant
        }
      }

      if (!cancelled) {
        setError("Could not parse diagram — showing source");
      }
    };

    render();
    return () => { cancelled = true; };
  }, [code, uid]);

  const handleDownload = useCallback(() => {
    downloadPng(modalOpen ? modalRef.current : thumbRef.current);
  }, [modalOpen]);

  // ── Error state ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        className="my-3 rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(255,79,107,0.2)", background: "rgba(255,79,107,0.04)" }}
      >
        <button
          type="button"
          onClick={() => setShowSource((p) => !p)}
          className="flex w-full items-center justify-between px-4 py-2.5"
        >
          <span className="font-mono text-[11px]" style={{ color: "rgba(255,79,107,0.8)" }}>
            ⚠ diagram syntax error — click to view source
          </span>
          {showSource ? <ChevronUp size={12} style={{ color: "rgba(255,79,107,0.6)" }} /> : <ChevronDown size={12} style={{ color: "rgba(255,79,107,0.6)" }} />}
        </button>
        {showSource && (
          <pre
            className="overflow-x-auto px-4 pb-4 text-[11px] leading-relaxed"
            style={{ color: "rgba(232,237,242,0.5)", fontFamily: "var(--font-mono)", margin: 0 }}
          >
            {code}
          </pre>
        )}
      </div>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (!svg) {
    return (
      <div
        className="my-3 flex items-center gap-2 rounded-xl px-4 py-3"
        style={{ background: "rgba(0,255,178,0.03)", border: "1px solid rgba(0,255,178,0.08)" }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--bio-primary)", animation: "bio-ping 1.5s ease-out infinite" }} />
        <span className="font-mono text-[11px]" style={{ color: "var(--bio-muted)" }}>rendering diagram…</span>
      </div>
    );
  }

  // ── Success state — thumbnail in chat ────────────────────────────────────────
  return (
    <>
      <div
        className="group relative my-4 overflow-hidden rounded-xl"
        style={{
          background: "rgba(8,11,15,0.9)",
          border: "1px solid rgba(0,255,178,0.12)",
          boxShadow: "0 0 24px rgba(0,255,178,0.03)",
        }}
      >
        {/* Top bar */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: "1px solid rgba(0,255,178,0.08)" }}
        >
          <span
            className="text-[9px] uppercase tracking-widest"
            style={{ color: "var(--bio-primary)", fontFamily: "var(--font-mono)", opacity: 0.8 }}
          >
            diagram
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              title="Download PNG"
              className="flex h-6 w-6 items-center justify-center rounded-lg transition-all"
              style={{ color: "var(--bio-muted)", background: "transparent" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-primary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)"; }}
            >
              <Download size={12} />
            </button>
            <button
              onClick={() => setModalOpen(true)}
              title="Expand diagram"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] transition-all"
              style={{
                color: "var(--bio-muted)",
                background: "rgba(0,255,178,0.04)",
                border: "1px solid rgba(0,255,178,0.1)",
                fontFamily: "var(--font-mono)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--bio-primary)";
                (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.1)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--bio-muted)";
                (e.currentTarget as HTMLElement).style.background = "rgba(0,255,178,0.04)";
              }}
            >
              <Maximize2 size={10} />
              expand
            </button>
          </div>
        </div>

        {/* Thumbnail — click anywhere to expand */}
        <div
          ref={thumbRef}
          className="cursor-pointer overflow-hidden px-4 py-3"
          style={{ maxHeight: "260px", position: "relative" }}
          onClick={() => setModalOpen(true)}
          title="Click to expand"
          dangerouslySetInnerHTML={{ __html: svg }}
        />

        {/* Fade overlay at bottom hinting there's more */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-10"
          style={{
            background: "linear-gradient(to bottom, transparent, rgba(8,11,15,0.95))",
          }}
        />
      </div>

      {/* Modal */}
      {modalOpen && (
        <DiagramModal
          svg={svg}
          onClose={() => setModalOpen(false)}
          onDownload={() => { downloadPng(modalRef.current); }}
          containerRef={modalRef}
        />
      )}
    </>
  );
};
