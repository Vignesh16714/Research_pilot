import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Compass, Eye, FileText, GitBranch, Globe, Sparkles, type LucideIcon } from "lucide-react";
import type { ScratchpadEntry } from "../types";

interface TracePanelProps {
  entries: ScratchpadEntry[];
  isRunning: boolean;
}

const NODE_META: Record<string, { label: string; icon: LucideIcon }> = {
  planner: { label: "Planner", icon: Compass },
  router: { label: "Router", icon: GitBranch },
  web_search_tool: { label: "Web Search", icon: Globe },
  pdf_reader_tool: { label: "PDF Reader", icon: FileText },
  reflect: { label: "Reflect", icon: Eye },
  synthesizer: { label: "Synthesizer", icon: Sparkles },
};

export function TracePanel({ entries, isRunning }: TracePanelProps) {
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-xs text-ink-300 hover:text-ink-100 px-1 py-2 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-accent-teal animate-pulse" : "bg-ink-500"}`} />
          {open ? "Hide reasoning" : "Show reasoning"} · {entries.length} step{entries.length === 1 ? "" : "s"}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={14} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="glass-panel p-3 flex flex-col gap-2 max-h-96 overflow-y-auto">
              {entries.map((entry, i) => {
                const meta = NODE_META[entry.node] ?? { label: entry.node, icon: Sparkles };
                const Icon = meta.icon;
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex gap-3 text-sm py-2 border-b border-white/5 last:border-none"
                  >
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-accent-teal">
                      <Icon size={13} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-ink-100">{meta.label}</span>
                        <span className="text-[11px] text-ink-500">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-ink-300 leading-snug">{entry.thought}</p>
                      {entry.tool_call && (
                        <code className="mt-1 block truncate text-[11px] text-accent-teal/90">{entry.tool_call}</code>
                      )}
                      {entry.tool_result && (
                        <p className="mt-0.5 truncate text-[11px] text-ink-500">{entry.tool_result}</p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
