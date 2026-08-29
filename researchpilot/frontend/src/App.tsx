import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles,
  Plus,
  History,
  Settings2,
  AlertTriangle,
  Volume2,
  VolumeX,
  ExternalLink,
  FileText,
  ChevronDown,
  Copy,
  Check,
  Download,
  FileCode,
  Printer,
  X,
  Maximize2,
  Minimize2,
  BookOpen,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { VoiceOrb } from "./components/VoiceOrb";
import { GoalForm } from "./components/GoalForm";
import { HistorySidebar } from "./components/HistorySidebar";
import { useAgentStream } from "./hooks/useAgentStream";
import { useVoice } from "./hooks/useVoice";
import type { EvidenceItem, HistoryItem, OrbState, ScratchpadEntry } from "./types";

const SUGGESTIONS = [
  "Compare MacBook Air M3, Dell XPS 13, and ASUS ZenBook 14 OLED — summarize battery life and build quality.",
  "What are the main technical differences between REST and GraphQL APIs?",
  "Read the uploaded PDFs and draft a literature review comparing their approaches.",
];

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: string[];
  evidence?: EvidenceItem[];
  scratchpad?: ScratchpadEntry[];
  status?: "running" | "done" | "error";
  currentStatusLine?: string;
  stepsUsed?: number;
}

export default function App() {
  const stream = useAgentStream();
  const [useUpgradedVoice, setUseUpgradedVoice] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false); // DEACTIVATED BY DEFAULT
  const voice = useVoice({ useUpgradedSTT: useUpgradedVoice, useUpgradedTTS: useUpgradedVoice });

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingGoalFromVoice, setPendingGoalFromVoice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);
  const [canvasContent, setCanvasContent] = useState<{ title: string; content: string; evidence?: EvidenceItem[] } | null>(null);
  const [canvasFontSize, setCanvasFontSize] = useState<"sm" | "base" | "lg">("base");

  const spokenRunIds = useRef<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);

  const getGreeting = () => {
    const hr = new Date().getHours();
    return hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  };

  // Auto-scroll chat feed to bottom on new messages / updates
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stream.scratchpad, stream.finalAnswer, stream.currentStatusLine]);

  // Sync active stream state into the latest assistant chat message
  useEffect(() => {
    if (!stream.runId) return;

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === stream.runId);
      if (idx === -1) return prev;

      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        content: stream.finalAnswer || "",
        evidence: stream.evidence,
        scratchpad: stream.scratchpad,
        status: stream.status as ChatMessage["status"],
        currentStatusLine: stream.currentStatusLine,
        stepsUsed: stream.stepsUsed,
      };
      return updated;
    });

    setHistory((prev) =>
      prev.map((item) => (item.run_id === stream.runId ? { ...item, status: stream.status as HistoryItem["status"] } : item))
    );
  }, [stream.runId, stream.status, stream.finalAnswer, stream.evidence, stream.scratchpad, stream.currentStatusLine, stream.stepsUsed]);

  // Speak the final answer ONLY IF Voice Assistant is activated
  useEffect(() => {
    if (voiceEnabled && stream.status === "done" && stream.finalAnswer && stream.runId && !spokenRunIds.current.has(stream.runId)) {
      spokenRunIds.current.add(stream.runId);
      voice.speak(stream.finalAnswer);
    }
  }, [voiceEnabled, stream.status, stream.finalAnswer, stream.runId, voice]);

  const runGoal = async (goal: string, files: File[] = []) => {
    voice.cancelSpeaking();

    const userMsgId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: goal,
      files: files.map((f) => f.name),
    };

    setMessages((prev) => [...prev, userMsg]);

    // Include follow-up conversational context if previous turns exist
    let contextualGoal = goal;
    if (messages.length >= 2) {
      const lastUser = messages.filter((m) => m.role === "user").pop()?.content || "";
      const lastAssistant = messages.filter((m) => m.role === "assistant").pop()?.content || "";
      if (lastUser && lastAssistant) {
        contextualGoal = `Context from previous turns:\nUser asked: "${lastUser}"\nAssistant answered: "${lastAssistant.slice(0, 400)}..."\n\nNew Question/Follow-up: ${goal}`;
      }
    }

    const runId = await stream.startRun(contextualGoal, files);
    if (runId) {
      const assistantMsg: ChatMessage = {
        id: runId,
        role: "assistant",
        content: "",
        status: "running",
        scratchpad: [],
        evidence: [],
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setHistory((prev) => [...prev, { run_id: runId, goal, startedAt: Date.now(), status: "running" }]);
    }
  };

  const startNewChat = () => {
    voice.cancelSpeaking();
    setMessages([]);
    setCanvasContent(null);
  };

  const toggleVoiceAssistant = () => {
    if (voiceEnabled) {
      voice.cancelSpeaking();
      voice.stopListening();
      setVoiceEnabled(false);
    } else {
      setVoiceEnabled(true);
    }
  };

  const handleMicClick = () => {
    if (!voiceEnabled) {
      setVoiceEnabled(true);
    }
    if (voice.isListening) {
      voice.stopListening();
      return;
    }
    voice.cancelSpeaking();
    voice.startListening(
      (text) => setPendingGoalFromVoice(text),
      () => {}
    );
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadMd = (text: string, id: string) => {
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-report-${id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadHtml = (text: string, id: string) => {
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ResearchPilot Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 20px; color: #1f2937; background: #f9fafb; }
    h1, h2, h3 { color: #111827; }
    code { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #1e293b; color: #f8fafc; padding: 16px; border-radius: 8px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; }
    th { background: #e5e7eb; }
  </style>
</head>
<body>
  ${text.replace(/\n/g, "<br>")}
</body>
</html>`;
    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-report-${id.slice(0, 8)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = (text: string, title = "Research Report") => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const htmlBody = text
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>");

    const doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; padding: 30px; max-width: 800px; margin: 0 auto; }
    h1 { color: #1d4ed8; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; font-size: 22px; }
    h2 { color: #1e40af; margin-top: 20px; border-bottom: 1px solid #f1f5f9; font-size: 17px; }
    h3 { color: #2563eb; margin-top: 14px; font-size: 14px; }
    p { margin-bottom: 12px; }
    strong { color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; }
    .header { font-size: 12px; color: #64748b; margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">ResearchPilot AI Assistant · ${new Date().toLocaleDateString()}</div>
  <h1>${title}</h1>
  <div><p>${htmlBody}</p></div>
  <div class="footer">Exported from ResearchPilot AI</div>
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

    printWindow.document.write(doc);
    printWindow.document.close();
  };

  const handleExportFullChatPdf = () => {
    if (messages.length === 0) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const chatHtml = messages
      .map((m) => {
        const roleName = m.role === "user" ? "User" : "ResearchPilot AI";
        const roleColor = m.role === "user" ? "#1e40af" : "#7e22ce";
        const formatted = m.content
          .replace(/^### (.*$)/gim, "<h3>$1</h3>")
          .replace(/^## (.*$)/gim, "<h2>$1</h2>")
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\n\n/g, "</p><p>")
          .replace(/\n/g, "<br>");
        return `<div style="margin-bottom: 20px; padding: 14px; border-radius: 8px; background: ${
          m.role === "user" ? "#f0f9ff" : "#faf5ff"
        }; border: 1px solid ${m.role === "user" ? "#bae6fd" : "#e9d5ff"};">
        <div style="font-weight: 700; color: ${roleColor}; margin-bottom: 6px; font-size: 13px;">${roleName}</div>
        <div><p>${formatted}</p></div>
      </div>`;
      })
      .join("");

    const doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ResearchPilot Chat Transcript</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; padding: 30px; max-width: 800px; margin: 0 auto; }
    h1 { color: #1d4ed8; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; font-size: 22px; margin-bottom: 20px; }
    p { margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; }
    th { background: #f8fafc; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>ResearchPilot Chat Transcript</h1>
  <div>${chatHtml}</div>
  <div class="footer">Exported from ResearchPilot AI · ${new Date().toLocaleDateString()}</div>
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

    printWindow.document.write(doc);
    printWindow.document.close();
  };

  useEffect(() => {
    if (pendingGoalFromVoice) {
      const goal = pendingGoalFromVoice;
      setPendingGoalFromVoice(null);
      runGoal(goal);
    }
  }, [pendingGoalFromVoice]);

  const orbState: OrbState = voice.isListening
    ? "listening"
    : voice.isSpeaking
    ? "speaking"
    : stream.status === "running" || stream.status === "pending"
    ? "thinking"
    : "idle";

  return (
    <div className="flex flex-col h-screen w-screen bg-[#131314] text-gray-100 overflow-hidden font-sans select-none">
      {/* Top Gemini Navigation Header */}
      <header className="h-14 border-b border-[#2e2f31] px-4 flex items-center justify-between shrink-0 bg-[#131314]/90 backdrop-blur-md z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="p-2 rounded-full hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
            title="History"
          >
            <History size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-400 animate-spin-slow" />
            <span className="font-semibold tracking-tight text-lg text-white">
              Research<span className="gemini-gradient-text">Pilot</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Activate / Deactivate Voice Assistant Switch */}
          <button
            onClick={toggleVoiceAssistant}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              voiceEnabled
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/40 shadow-sm"
                : "bg-[#1e1f20] text-gray-400 border border-white/10 hover:text-gray-200"
            }`}
            title={voiceEnabled ? "Click to deactivate Voice Assistant" : "Click to activate Voice Assistant"}
          >
            {voiceEnabled ? (
              <>
                <Volume2 size={13} className="animate-pulse text-blue-400" />
                <span>Voice Assistant: ON</span>
              </>
            ) : (
              <>
                <VolumeX size={13} />
                <span>Voice Assistant: OFF</span>
              </>
            )}
          </button>

          {/* Export Full Chat PDF Button */}
          {messages.length > 0 && (
            <button
              onClick={handleExportFullChatPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1e1f20] hover:bg-[#282a2c] border border-white/10 text-xs text-gray-200 transition-colors"
              title="Export full chat transcript as PDF"
            >
              <Printer size={14} className="text-purple-400" />
              <span>Export Chat PDF</span>
            </button>
          )}

          <button
            onClick={startNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1e1f20] hover:bg-[#282a2c] border border-white/10 text-xs text-gray-200 transition-colors"
          >
            <Plus size={14} className="text-blue-400" />
            <span>New Chat</span>
          </button>

          <button
            onClick={() => setShowSettings((s) => !s)}
            className="p-2 rounded-full hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
            title="Settings"
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      {/* History Sidebar */}
      <HistorySidebar
        items={history}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        onSelect={async (runId) => {
          setSidebarOpen(false);
          voice.cancelSpeaking();
          await stream.loadRun(runId);
        }}
        activeRunId={stream.runId}
      />

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed top-16 right-5 z-40 bg-[#1e1f20] border border-[#2e2f31] p-4 rounded-2xl w-72 text-sm shadow-2xl space-y-3"
          >
            <h3 className="font-medium text-white flex items-center gap-2">
              <Settings2 size={15} className="text-blue-400" /> Settings
            </h3>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={voiceEnabled}
                onChange={(e) => setVoiceEnabled(e.target.checked)}
                className="mt-1 accent-blue-500"
              />
              <span>
                <span className="block text-gray-200 font-medium">Activate Voice Assistant</span>
                <span className="block text-gray-400 text-xs mt-0.5">
                  Allows spoken voice input and automatic response reading in warm female voice.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer pt-2 border-t border-white/10">
              <input
                type="checkbox"
                checked={useUpgradedVoice}
                onChange={(e) => setUseUpgradedVoice(e.target.checked)}
                className="mt-1 accent-blue-500"
              />
              <span>
                <span className="block text-gray-200 font-medium">Groq Speech Engine</span>
                <span className="block text-gray-400 text-xs mt-0.5">
                  Whisper STT + PlayAI TTS audio.
                </span>
              </span>
            </label>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Chat Feed Area */}
      <main className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto px-4 pt-6 pb-36 space-y-6">
        {messages.length === 0 ? (
          /* Gemini Welcome Hero with Dynamic Time-Based Greeting */
          <div className="h-full flex flex-col items-center justify-center text-center px-4 my-auto relative">
            {/* Sparkling ambient particle glow */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-72 h-72 rounded-full bg-gradient-to-tr from-blue-500/10 via-purple-500/10 to-teal-500/10 blur-3xl" />
            </div>

            <div className="relative z-10 p-3 rounded-full bg-blue-500/10 border border-blue-500/20 mb-4 shadow-xl">
              <Sparkles className="w-8 h-8 text-blue-400 animate-pulse" />
            </div>

            <h1 className="relative z-10 text-3xl sm:text-4xl font-semibold text-white tracking-tight mb-2">
              {getGreeting()}, <span className="gemini-gradient-text">Researcher</span>
            </h1>
            <p className="relative z-10 text-gray-400 text-sm max-w-md mb-8">
              What would you like to explore today? ResearchPilot breaks down goals, searches the web, reads PDFs, and synthesizes cited answers.
            </p>

            <div className="relative z-10 w-full max-w-2xl grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => runGoal(s)}
                  className="text-left p-3.5 rounded-2xl bg-[#1e1f20] hover:bg-[#282a2c] border border-[#2e2f31] hover:border-blue-500/40 text-xs text-gray-300 hover:text-white transition-all shadow-sm flex flex-col justify-between"
                >
                  <p className="leading-relaxed">{s}</p>
                  <Sparkles size={12} className="text-blue-400 mt-2 self-end" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Chat History Feed */
          messages.map((msg) => (
            <div key={msg.id} className="space-y-4">
              {msg.role === "user" ? (
                /* User Message Bubble */
                <div className="flex justify-end">
                  <div className="max-w-2xl bg-[#282a2c] text-gray-100 px-4 py-3 rounded-2xl rounded-tr-sm border border-white/5 shadow-sm text-sm space-y-2">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.files && msg.files.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {msg.files.map((filename, fIdx) => (
                          <span
                            key={fIdx}
                            className="inline-flex items-center gap-1 text-[11px] bg-white/10 px-2 py-0.5 rounded-full text-blue-300"
                          >
                            <FileText size={11} /> {filename}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Assistant Message Bubble */
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0 shadow-md mt-1">
                    <Sparkles className="w-4.5 h-4.5 text-white" />
                  </div>

                  <div className="flex-1 min-w-0 bg-[#1e1f20] border border-[#2e2f31] rounded-2xl rounded-tl-sm p-5 space-y-4 shadow-sm">
                    {/* Live Progress / Reasoning Accordion */}
                    {msg.scratchpad && msg.scratchpad.length > 0 && (
                      <ReasoningAccordion entries={msg.scratchpad} isRunning={msg.status === "running"} />
                    )}

                    {/* Active Status Line */}
                    {msg.status === "running" && (
                      <div className="flex items-center gap-2 text-xs text-blue-400">
                        <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                        <span>{msg.currentStatusLine || "Researching & processing evidence..."}</span>
                      </div>
                    )}

                    {/* Final Answer Markdown */}
                    {msg.content ? (
                      <div className="prose prose-invert prose-sm sm:prose-base max-w-none prose-headings:text-white prose-a:text-blue-400 hover:prose-a:underline prose-table:text-sm">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.status !== "running" && <p className="text-gray-400 text-sm italic">Synthesizing research output...</p>
                    )}

                    {/* Evidence & Citations */}
                    {msg.evidence && msg.evidence.length > 0 && (
                      <div className="pt-3 border-t border-[#2e2f31]">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Sources & Evidence</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {msg.evidence.map((item, eIdx) => (
                            <button
                              key={eIdx}
                              onClick={() => setSelectedEvidence(item)}
                              className="text-left flex items-start gap-2 p-2 rounded-lg bg-[#282a2c] hover:bg-[#323437] border border-white/5 text-xs text-gray-300 hover:text-white transition-colors truncate"
                              title="Click to inspect extracted passage snippet"
                            >
                              {item.source_type === "web" ? (
                                <ExternalLink size={13} className="text-blue-400 mt-0.5 shrink-0" />
                              ) : (
                                <FileText size={13} className="text-purple-400 mt-0.5 shrink-0" />
                              )}
                              <span className="truncate">{item.title}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* One-Click Export & Gemini Canvas Action Bar */}
                    {msg.content && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#2e2f31]/60 text-xs">
                        <div className="flex items-center gap-1.5">
                          {/* Gemini Canvas Open Button */}
                          <button
                            onClick={() =>
                              setCanvasContent({
                                title: "Research Report Canvas",
                                content: msg.content,
                                evidence: msg.evidence,
                              })
                            }
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 transition-colors font-medium"
                            title="Expand into full-screen Reading Canvas"
                          >
                            <BookOpen size={13} />
                            <span>Gemini Canvas</span>
                          </button>

                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#282a2c] hover:bg-[#323437] text-gray-300 hover:text-white transition-colors"
                            title="Copy Markdown"
                          >
                            {copiedId === msg.id ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                            <span>{copiedId === msg.id ? "Copied" : "Copy"}</span>
                          </button>

                          <button
                            onClick={() => handleDownloadPdf(msg.content, "Research Report")}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#282a2c] hover:bg-[#323437] text-gray-300 hover:text-white transition-colors"
                            title="Export Response as PDF"
                          >
                            <Printer size={13} className="text-purple-400" />
                            <span>PDF</span>
                          </button>

                          <button
                            onClick={() => handleDownloadMd(msg.content, msg.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#282a2c] hover:bg-[#323437] text-gray-300 hover:text-white transition-colors"
                            title="Download as Markdown file"
                          >
                            <Download size={13} />
                            <span>Markdown</span>
                          </button>

                          <button
                            onClick={() => handleDownloadHtml(msg.content, msg.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#282a2c] hover:bg-[#323437] text-gray-300 hover:text-white transition-colors"
                            title="Export standalone HTML Report"
                          >
                            <FileCode size={13} className="text-blue-400" />
                            <span>HTML</span>
                          </button>
                        </div>

                        <button
                          onClick={() => voice.speak(msg.content)}
                          className="flex items-center gap-1 text-gray-400 hover:text-blue-400 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
                          title="Listen in female voice"
                        >
                          <Volume2 size={13} />
                          <span>Listen</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {/* Global Error Notice */}
        {stream.error && (
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Error Occurred</p>
              <p className="text-xs text-red-200 mt-0.5">{stream.error.message}</p>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </main>

      {/* Gemini Canvas Split-View Reading Drawer */}
      <AnimatePresence>
        {canvasContent && (
          <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-md p-2 sm:p-6">
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              className="bg-[#18191a] border border-[#2e2f31] rounded-3xl w-full max-w-4xl h-full flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Canvas Header Toolbar */}
              <div className="h-14 border-b border-[#2e2f31] px-6 flex items-center justify-between bg-[#1e1f20] shrink-0">
                <div className="flex items-center gap-3">
                  <BookOpen className="w-5 h-5 text-blue-400" />
                  <h2 className="font-semibold text-white text-base tracking-tight">{canvasContent.title}</h2>
                </div>

                <div className="flex items-center gap-2">
                  {/* Font Size Selector */}
                  <div className="flex items-center bg-[#131314] rounded-lg p-1 border border-white/10 text-xs">
                    <button
                      onClick={() => setCanvasFontSize("sm")}
                      className={`px-2 py-0.5 rounded ${canvasFontSize === "sm" ? "bg-blue-500 text-white" : "text-gray-400"}`}
                    >
                      A-
                    </button>
                    <button
                      onClick={() => setCanvasFontSize("base")}
                      className={`px-2 py-0.5 rounded ${canvasFontSize === "base" ? "bg-blue-500 text-white" : "text-gray-400"}`}
                    >
                      A
                    </button>
                    <button
                      onClick={() => setCanvasFontSize("lg")}
                      className={`px-2 py-0.5 rounded ${canvasFontSize === "lg" ? "bg-blue-500 text-white" : "text-gray-400"}`}
                    >
                      A+
                    </button>
                  </div>

                  <button
                    onClick={() => handleDownloadPdf(canvasContent.content, canvasContent.title)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#282a2c] hover:bg-[#323437] text-xs text-gray-200"
                    title="Export Canvas as PDF"
                  >
                    <Printer size={14} className="text-purple-400" />
                    <span>PDF</span>
                  </button>

                  <button
                    onClick={() => setCanvasContent(null)}
                    className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Canvas Content Body */}
              <div className="flex-1 overflow-y-auto p-8 sm:p-12 bg-[#131314]">
                <div
                  className={`prose prose-invert max-w-none prose-headings:text-white prose-a:text-blue-400 ${
                    canvasFontSize === "sm" ? "prose-sm" : canvasFontSize === "lg" ? "prose-lg" : "prose-base"
                  }`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{canvasContent.content}</ReactMarkdown>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Evidence Snippet Inspector Drawer Modal */}
      <AnimatePresence>
        {selectedEvidence && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1e1f20] border border-[#2e2f31] rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-3"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  {selectedEvidence.source_type === "web" ? (
                    <ExternalLink size={16} className="text-blue-400" />
                  ) : (
                    <FileText size={16} className="text-purple-400" />
                  )}
                  <h3 className="font-medium text-white text-sm truncate max-w-[340px]">{selectedEvidence.title}</h3>
                </div>
                <button
                  onClick={() => setSelectedEvidence(null)}
                  className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-white/10"
                >
                  <X size={16} />
                </button>
              </div>

              {selectedEvidence.url && (
                <a
                  href={selectedEvidence.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 hover:underline block truncate"
                >
                  {selectedEvidence.url}
                </a>
              )}

              <div className="bg-[#131314] p-3 rounded-xl border border-white/5 max-h-60 overflow-y-auto">
                <p className="text-xs text-gray-300 leading-relaxed font-mono whitespace-pre-wrap">
                  {selectedEvidence.snippet}
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setSelectedEvidence(null)}
                  className="px-4 py-1.5 rounded-full bg-[#282a2c] hover:bg-[#323437] text-xs text-gray-200"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Bottom Prompt Bar (Always Enabled) */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 z-40">
        <GoalForm onSubmit={runGoal} onMicClick={handleMicClick} isListening={voice.isListening} />
      </div>

      {/* Floating Siri-Style Voice Orb */}
      <VoiceOrb state={orbState} analyser={voice.analyser} onClick={handleMicClick} enabled={voiceEnabled} />
    </div>
  );
}

// Collapsible Reasoning Steps Accordion inside Assistant Message
function ReasoningAccordion({ entries, isRunning }: { entries: ScratchpadEntry[]; isRunning?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!entries || entries.length === 0) return null;

  return (
    <div className="border border-[#2e2f31] rounded-xl overflow-hidden bg-[#18191a]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-300 hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-blue-400 animate-ping" : "bg-gray-500"}`} />
          <span>Research Steps ({entries.length})</span>
        </span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="p-3 border-t border-[#2e2f31] space-y-2 max-h-60 overflow-y-auto text-xs">
          {entries.map((entry, idx) => (
            <div key={idx} className="flex items-start gap-2 text-gray-300">
              <span className="font-medium text-blue-400 min-w-[75px] shrink-0 uppercase tracking-wider text-[10px]">
                {entry.node}
              </span>
              <p className="flex-1 text-gray-300">{entry.thought}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
