import { useRef, useState } from "react";
import { Mic, Paperclip, SendHorizontal, Wand2, X } from "lucide-react";

interface GoalFormProps {
  onSubmit: (goal: string, files: File[]) => void;
  onMicClick: () => void;
  isListening: boolean;
  disabled?: boolean;
  initialGoal?: string;
}

export function GoalForm({ onSubmit, onMicClick, isListening, initialGoal = "" }: GoalFormProps) {
  const [goal, setGoal] = useState(initialGoal);
  const [files, setFiles] = useState<File[]>([]);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;
    const text = goal.trim();
    setGoal("");
    onSubmit(text, files);
    setFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleEnhancePrompt = () => {
    setIsEnhancing(true);
    const raw = goal.trim();
    let enhanced = "";

    if (!raw) {
      enhanced = "Compare the latest M3 MacBook Air, Dell XPS 13, and Asus ZenBook 14 OLED on battery life, display quality, and performance.";
    } else if (raw.toLowerCase().includes("vs") || raw.toLowerCase().includes("compare")) {
      enhanced = `Provide a comprehensive side-by-side comparison of ${raw}. Include key technical specifications, real-world benchmarks, pricing, pros & cons, and a final verdict table.`;
    } else if (raw.toLowerCase().includes("pdf") || raw.toLowerCase().includes("paper") || raw.toLowerCase().includes("review")) {
      enhanced = `Analyze the uploaded documents and draft a structured literature review summarizing key methodologies, empirical findings, comparative advantages, and open research gaps: ${raw}`;
    } else {
      enhanced = `Provide an in-depth research report on ${raw}. Break down the core concepts, current industry trends, key advantages, potential trade-offs, and practical recommendations.`;
    }

    setTimeout(() => {
      setGoal(enhanced);
      setIsEnhancing(false);
    }, 300);
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const pdfs = Array.from(list).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    setFiles((prev) => [...prev, ...pdfs]);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full flex flex-col gap-2">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 py-1">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="flex items-center gap-1.5 text-xs bg-[#282a2c] border border-white/10 rounded-full px-3 py-1 text-gray-200"
            >
              <Paperclip size={12} className="text-blue-400" />
              <span className="max-w-[150px] truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="hover:text-red-400 ml-0.5"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative flex items-center bg-[#1e1f20] border border-[#2e2f31] focus-within:border-[#4285f4]/60 rounded-3xl px-4 py-2.5 shadow-2xl transition-all">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach PDFs"
          className="p-2 rounded-full text-gray-400 hover:text-blue-400 hover:bg-white/5 transition-colors shrink-0"
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />

        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask ResearchPilot or enter a research goal..."
          rows={1}
          className="flex-1 bg-transparent border-none outline-none px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-500 resize-none max-h-32 min-h-[36px]"
        />

        <div className="flex items-center gap-1 shrink-0">
          {/* Smart Prompt Enhancer Button */}
          <button
            type="button"
            onClick={handleEnhancePrompt}
            title="Smart Prompt Enhancer (Magic Wand)"
            className={`p-2 rounded-full transition-all ${
              isEnhancing
                ? "text-purple-400 bg-purple-500/20 animate-spin"
                : "text-gray-400 hover:text-purple-400 hover:bg-white/5"
            }`}
          >
            <Wand2 size={17} />
          </button>

          {/* Voice Input Button */}
          <button
            type="button"
            onClick={onMicClick}
            title="Voice input"
            className={`p-2 rounded-full transition-colors ${
              isListening
                ? "text-blue-400 bg-blue-500/20 animate-pulse"
                : "text-gray-400 hover:text-blue-400 hover:bg-white/5"
            }`}
          >
            <Mic size={18} />
          </button>

          {/* Send Button */}
          <button
            type="submit"
            disabled={!goal.trim()}
            className="p-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-white disabled:opacity-30 disabled:pointer-events-none hover:opacity-95 transition-opacity shadow-md"
          >
            <SendHorizontal size={17} />
          </button>
        </div>
      </div>
    </form>
  );
}
