import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import { Volume2, ExternalLink, FileText } from "lucide-react";
import type { EvidenceItem } from "../types";

interface AnswerPanelProps {
  answer: string;
  evidence: EvidenceItem[];
  onReplay: () => void;
}

export function AnswerPanel({ answer, evidence, onReplay }: AnswerPanelProps) {
  const webSources = evidence.filter((e) => e.source_type === "web");
  const pdfSources = evidence.filter((e) => e.source_type === "pdf");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="w-full max-w-2xl mx-auto flex flex-col gap-4"
    >
      <div className="glass-panel p-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <h2 className="text-sm font-medium tracking-wide text-ink-300 uppercase">Answer</h2>
          <button
            onClick={onReplay}
            title="Play the answer aloud"
            className="shrink-0 p-2 rounded-lg text-ink-300 hover:text-accent-teal hover:bg-white/5 transition-colors"
          >
            <Volume2 size={16} />
          </button>
        </div>
        <div className="prose prose-invert prose-sm sm:prose-base max-w-none prose-headings:font-display prose-a:text-accent-teal prose-a:no-underline hover:prose-a:underline prose-table:text-sm prose-th:text-ink-300">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      </div>

      {(webSources.length > 0 || pdfSources.length > 0) && (
        <div className="glass-panel p-5">
          <h3 className="text-xs font-medium tracking-wide text-ink-300 uppercase mb-3">Sources</h3>
          <ul className="flex flex-col gap-2">
            {webSources.map((e, i) => (
              <li key={`web-${i}`} className="flex items-start gap-2 text-sm">
                <ExternalLink size={13} className="mt-1 shrink-0 text-accent-indigo" />
                <a href={e.url ?? "#"} target="_blank" rel="noreferrer" className="text-ink-300 hover:text-accent-teal truncate">
                  {e.title}
                </a>
              </li>
            ))}
            {pdfSources.map((e, i) => (
              <li key={`pdf-${i}`} className="flex items-start gap-2 text-sm">
                <FileText size={13} className="mt-1 shrink-0 text-accent-violet" />
                <span className="text-ink-300 truncate">
                  {e.filename} — page {e.page}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
