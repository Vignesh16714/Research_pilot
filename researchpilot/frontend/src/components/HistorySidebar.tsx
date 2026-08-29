import { motion, AnimatePresence } from "framer-motion";
import { History, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { HistoryItem } from "../types";

interface HistorySidebarProps {
  items: HistoryItem[];
  open: boolean;
  onToggle: () => void;
  onSelect: (runId: string) => void;
  activeRunId: string | null;
}

const STATUS_ICON = {
  pending: Loader2,
  running: Loader2,
  done: CheckCircle2,
  error: AlertCircle,
};

export function HistorySidebar({ items, open, onToggle, onSelect, activeRunId }: HistorySidebarProps) {
  return (
    <>
      <button
        onClick={onToggle}
        title="Run history"
        className="fixed top-5 left-5 z-30 p-2.5 rounded-full glass-panel text-ink-300 hover:text-accent-teal transition-colors"
      >
        <History size={16} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onToggle}
              className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px]"
            />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="fixed left-0 top-0 z-40 h-full w-80 glass-panel rounded-none border-r border-white/10 p-5 flex flex-col gap-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium tracking-wide text-ink-100">Run history</h2>
                <button onClick={onToggle} className="p-1 text-ink-300 hover:text-ink-100">
                  <X size={16} />
                </button>
              </div>

              {items.length === 0 ? (
                <p className="text-sm text-ink-500">Runs from this session will show up here.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 overflow-y-auto">
                  {items
                    .slice()
                    .reverse()
                    .map((item) => {
                      const Icon = STATUS_ICON[item.status] ?? Loader2;
                      const active = item.run_id === activeRunId;
                      return (
                        <li key={item.run_id}>
                          <button
                            onClick={() => onSelect(item.run_id)}
                            className={`w-full text-left flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                              active ? "bg-white/10 text-ink-100" : "text-ink-300 hover:bg-white/5"
                            }`}
                          >
                            <Icon
                              size={14}
                              className={`mt-0.5 shrink-0 ${
                                item.status === "running" || item.status === "pending" ? "animate-spin text-accent-teal" : ""
                              } ${item.status === "done" ? "text-accent-teal" : ""} ${
                                item.status === "error" ? "text-red-400" : ""
                              }`}
                            />
                            <span className="line-clamp-2">{item.goal}</span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
