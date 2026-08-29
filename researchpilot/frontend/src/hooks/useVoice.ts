import { useCallback, useRef, useState } from "react";

interface UseVoiceOptions {
  useUpgradedSTT?: boolean;
  useUpgradedTTS?: boolean;
}

/**
 * Voice layer on top of the same goal-input flow. Defaults to the
 * browser's zero-setup Web Speech API for both STT and TTS. When the
 * upgrade toggles are on, STT records a clip and posts it to
 * /api/voice/transcribe (Groq Whisper) and TTS posts to /api/voice/speak
 * (Groq PlayAI), falling back to the browser APIs if either call fails.
 *
 * Exposes a live `analyser` (Web Audio AnalyserNode) hooked to whichever
 * source is currently active — mic input while listening, audio playback
 * while speaking — so VoiceOrb can react to real volume/pitch instead of
 * a canned animation.
 */
export function useVoice({ useUpgradedSTT = false, useUpgradedTTS = false }: UseVoiceOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new Ctor();
    }
    return audioContextRef.current;
  }, []);

  const attachMicAnalyser = useCallback(
    (stream: MediaStream) => {
      const ctx = getAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createAnalyser();
      node.fftSize = 256;
      source.connect(node);
      setAnalyser(node);
      return node;
    },
    [getAudioContext]
  );

  const stopMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setAnalyser(null);
    setIsListening(false);
  }, []);

  // --- Speech-to-text ------------------------------------------------------

  const listenBrowser = useCallback(
    (onResult: (text: string) => void, onEnd?: () => void) => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        onEnd?.();
        window.alert(
          "Speech recognition isn't supported in this browser. Try Chrome or Edge, or type your goal instead."
        );
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event: any) => onResult(event.results[0][0].transcript);
      recognition.onend = () => {
        stopMic();
        onEnd?.();
      };
      recognition.onerror = () => {
        stopMic();
        onEnd?.();
      };
      recognitionRef.current = recognition;

      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          streamRef.current = stream;
          attachMicAnalyser(stream);
          setIsListening(true);
          recognition.start();
        })
        .catch(() => {
          // Mic access for the visualizer failed but recognition may still
          // work via its own permission prompt — try anyway.
          setIsListening(true);
          recognition.start();
        });
    },
    [attachMicAnalyser, stopMic]
  );

  const listenUpgraded = useCallback(
    async (onResult: (text: string) => void, onEnd?: () => void) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      attachMicAnalyser(stream);
      setIsListening(true);

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stopMic();
        const blob = new Blob(chunks, { type: "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "clip.webm");
        try {
          const resp = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          if (resp.ok) {
            const data = await resp.json();
            onResult(data.text);
          }
        } finally {
          onEnd?.();
        }
      };
      recorder.start();

      // Auto-stop on ~1.2s of silence.
      const ctx = getAudioContext();
      const silenceNode = ctx.createAnalyser();
      silenceNode.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(silenceNode);
      const data = new Uint8Array(silenceNode.frequencyBinCount);
      let silenceStart: number | null = null;
      const SILENCE_THRESHOLD = 8;
      const SILENCE_MS = 1200;

      const check = () => {
        if (recorder.state !== "recording") return;
        silenceNode.getByteTimeDomainData(data);
        const level = data.reduce((acc, v) => acc + Math.abs(v - 128), 0) / data.length;
        if (level < SILENCE_THRESHOLD) {
          if (silenceStart === null) silenceStart = Date.now();
          else if (Date.now() - silenceStart > SILENCE_MS) {
            recorder.stop();
            return;
          }
        } else {
          silenceStart = null;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    },
    [attachMicAnalyser, getAudioContext, stopMic]
  );

  const startListening = useCallback(
    (onResult: (text: string) => void, onEnd?: () => void) => {
      if (useUpgradedSTT) {
        listenUpgraded(onResult, onEnd).catch(() => onEnd?.());
      } else {
        listenBrowser(onResult, onEnd);
      }
    },
    [useUpgradedSTT, listenBrowser, listenUpgraded]
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    stopMic();
  }, [stopMic]);

  // --- Text-to-speech -------------------------------------------------------

  const speakBrowser = useCallback((text: string, onEnd?: () => void) => {
    if (!("speechSynthesis" in window)) {
      onEnd?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);

    const getFemaleVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      return (
        voices.find(
          (v) =>
            v.lang.startsWith("en") &&
            (v.name.toLowerCase().includes("zira") ||
              v.name.toLowerCase().includes("jenny") ||
              v.name.toLowerCase().includes("samantha") ||
              v.name.toLowerCase().includes("victoria") ||
              v.name.toLowerCase().includes("google us english") ||
              v.name.toLowerCase().includes("female") ||
              v.name.toLowerCase().includes("natural") ||
              v.name.toLowerCase().includes("aria") ||
              v.name.toLowerCase().includes("eva") ||
              v.name.toLowerCase().includes("karen"))
        ) || voices.find((v) => v.lang.startsWith("en"))
      );
    };

    const femaleVoice = getFemaleVoice();
    if (femaleVoice) {
      utterance.voice = femaleVoice;
    }
    utterance.pitch = 1.1; // Warm female voice pitch

    utterance.onend = () => {
      setIsSpeaking(false);
      setAnalyser(null);
      onEnd?.();
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      onEnd?.();
    };
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, []);

  const speakUpgraded = useCallback(
    async (text: string, onEnd?: () => void) => {
      try {
        const resp = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!resp.ok) {
          speakBrowser(text, onEnd);
          return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const audioEl = new Audio(url);
        const ctx = getAudioContext();
        const source = ctx.createMediaElementSource(audioEl);
        const node = ctx.createAnalyser();
        node.fftSize = 256;
        source.connect(node);
        node.connect(ctx.destination);
        setAnalyser(node);
        setIsSpeaking(true);
        audioEl.onended = () => {
          setIsSpeaking(false);
          setAnalyser(null);
          URL.revokeObjectURL(url);
          onEnd?.();
        };
        await audioEl.play();
      } catch {
        speakBrowser(text, onEnd);
      }
    },
    [getAudioContext, speakBrowser]
  );

  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      // Keep spoken summaries speakable: strip markdown syntax and cap length.
      const plain = text
        .replace(/[#*_`>]/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .slice(0, 600);
      if (useUpgradedTTS) speakUpgraded(plain, onEnd);
      else speakBrowser(plain, onEnd);
    },
    [useUpgradedTTS, speakUpgraded, speakBrowser]
  );

  const cancelSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setAnalyser(null);
  }, []);

  return {
    isListening,
    isSpeaking,
    analyser,
    startListening,
    stopListening,
    speak,
    cancelSpeaking,
  };
}
