import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, Volume2, Sparkles } from "lucide-react";
import type { OrbState } from "../types";

interface VoiceOrbProps {
  state: OrbState;
  analyser: AnalyserNode | null;
  onClick?: () => void;
  enabled?: boolean;
}

export function VoiceOrb({ state, analyser, onClick, enabled = false }: VoiceOrbProps) {
  const coreRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!analyser || !enabled) {
      if (coreRef.current) coreRef.current.style.transform = "scale(1)";
      if (glowRef.current) glowRef.current.style.opacity = "0";
      return undefined;
    }

    const freqData = new Uint8Array(analyser.frequencyBinCount);

    const loop = () => {
      analyser.getByteFrequencyData(freqData);
      const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length;
      const level = Math.min(1, avg / 120);

      if (state === "speaking") {
        if (coreRef.current) coreRef.current.style.transform = `scale(${1 + level * 0.25})`;
        if (glowRef.current) glowRef.current.style.opacity = String(0.4 + level * 0.6);
      } else if (state === "listening") {
        if (coreRef.current) coreRef.current.style.transform = `scale(${1 + level * 0.4})`;
        if (glowRef.current) glowRef.current.style.opacity = String(0.5 + level * 0.5);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, state, enabled]);

  const isActive = enabled && (state === "listening" || state === "speaking");

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
      <button
        onClick={onClick}
        title={
          !enabled
            ? "Voice Assistant is OFF. Tap to activate."
            : state === "listening"
            ? "Listening... Tap to stop"
            : state === "speaking"
            ? "Speaking... Tap to cancel"
            : state === "thinking"
            ? "Agent is thinking..."
            : "Voice Assistant ON (Tap to talk)"
        }
        className={`group relative flex items-center justify-center w-12 h-12 rounded-full border shadow-2xl transition-all hover:scale-105 active:scale-95 outline-none p-2.5 ${
          enabled
            ? "bg-[#1e1f20] border-blue-500/50"
            : "bg-[#18191a] border-white/10 opacity-70 hover:opacity-100"
        }`}
      >
        {/* Ambient aura glow (only when active/enabled) */}
        {enabled && (
          <div
            ref={glowRef}
            className="absolute inset-[-6px] rounded-full pointer-events-none transition-opacity duration-300"
            style={{
              background:
                state === "listening"
                  ? "radial-gradient(circle, rgba(66, 133, 244, 0.8), rgba(161, 66, 244, 0.6), transparent 70%)"
                  : state === "speaking"
                  ? "radial-gradient(circle, rgba(45, 212, 191, 0.8), rgba(66, 133, 244, 0.6), transparent 70%)"
                  : state === "thinking"
                  ? "radial-gradient(circle, rgba(161, 66, 244, 0.8), rgba(66, 133, 244, 0.6), transparent 70%)"
                  : "radial-gradient(circle, rgba(66, 133, 244, 0.3), transparent 70%)",
              filter: "blur(6px)",
              opacity: 0.5,
            }}
          />
        )}

        {/* Thinking spinner ring */}
        {enabled && state === "thinking" && (
          <motion.div
            className="absolute inset-[-4px] rounded-full pointer-events-none"
            style={{
              background: "conic-gradient(from 0deg, #4285f4, #a142f4, #2dd4bf, #4285f4)",
              filter: "blur(3px)",
              opacity: 0.8,
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
          />
        )}

        {/* Core Siri-style orb */}
        <div
          ref={coreRef}
          className="relative z-10 w-full h-full rounded-full flex items-center justify-center shadow-lg transition-all duration-200"
          style={{
            background: !enabled
              ? "radial-gradient(circle at 35% 35%, #4b5563, #374151 90%)"
              : state === "listening"
              ? "radial-gradient(circle at 35% 35%, #60a5fa, #3b82f6 50%, #1d4ed8 90%)"
              : state === "speaking"
              ? "radial-gradient(circle at 35% 35%, #2dd4bf, #0d9488 50%, #0f766e 90%)"
              : state === "thinking"
              ? "radial-gradient(circle at 35% 35%, #c084fc, #9333ea 50%, #6b21a8 90%)"
              : "radial-gradient(circle at 35% 35%, #38bdf8, #4285f4 50%, #7c3aed 90%)",
          }}
        >
          {!enabled ? (
            <MicOff className="w-4.5 h-4.5 text-gray-400" />
          ) : state === "listening" ? (
            <Mic className="w-4.5 h-4.5 text-white animate-pulse" />
          ) : state === "speaking" ? (
            <Volume2 className="w-4.5 h-4.5 text-white animate-bounce" />
          ) : state === "thinking" ? (
            <Sparkles className="w-4.5 h-4.5 text-white animate-spin" />
          ) : (
            <Mic className="w-4.5 h-4.5 text-white/90 group-hover:scale-110 transition-transform" />
          )}
        </div>
      </button>

      {isActive && (
        <span className="hidden sm:block text-xs text-gray-300 bg-[#1e1f20]/90 border border-white/10 px-2.5 py-1 rounded-full shadow-lg backdrop-blur-md">
          {state === "listening" ? "Listening..." : "Speaking..."}
        </span>
      )}
    </div>
  );
}
