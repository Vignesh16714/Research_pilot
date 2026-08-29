import { useCallback, useRef, useState } from "react";
import type { ApiError, EvidenceItem, GoalType, RunStatus, ScratchpadEntry } from "../types";

interface AgentStreamState {
  runId: string | null;
  status: RunStatus | "idle";
  plan: string[];
  goalType: GoalType | null;
  scratchpad: ScratchpadEntry[];
  evidence: EvidenceItem[];
  finalAnswer: string | null;
  currentStatusLine: string;
  error: ApiError | null;
  stepsUsed: number;
  retries: number;
}

const INITIAL_STATE: AgentStreamState = {
  runId: null,
  status: "idle",
  plan: [],
  goalType: null,
  scratchpad: [],
  evidence: [],
  finalAnswer: null,
  currentStatusLine: "",
  error: null,
  stepsUsed: 0,
  retries: 0,
};

// Short, human status lines shown next to the orb — derived from which
// node just ran, not a raw dump of the scratchpad thought.
function statusLineFor(node: string, thought: string): string {
  switch (node) {
    case "planner":
      return "Planning the approach…";
    case "router":
      return "Deciding what to do next…";
    case "web_search_tool":
      return "Searching the web…";
    case "pdf_reader_tool":
      return "Reading the documents…";
    case "reflect":
      return "Checking the evidence…";
    case "synthesizer":
      return "Writing the answer…";
    default:
      return thought;
  }
}

export function useAgentStream() {
  const [state, setState] = useState<AgentStreamState>(INITIAL_STATE);
  const eventSourceRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const fetchFinalResult = useCallback(async (runId: string) => {
    const resp = await fetch(`/api/agent/result/${runId}`);
    if (!resp.ok) return;
    const data = await resp.json();
    setState((prev) => ({
      ...prev,
      status: data.status,
      plan: data.plan,
      goalType: data.goal_type,
      evidence: data.evidence,
      scratchpad: data.scratchpad,
      finalAnswer: data.final_answer,
      error: data.error ? { kind: "internal_error", message: data.error } : prev.error,
      stepsUsed: data.steps_used,
      retries: data.retries,
    }));
  }, []);

  const startRun = useCallback(
    async (goal: string, files: File[] = [], documentIds: string[] = []) => {
      reset();
      setState((prev) => ({ ...prev, status: "pending", currentStatusLine: "Starting up…" }));

      const form = new FormData();
      form.append("goal", goal);
      form.append("document_ids", documentIds.join(","));
      for (const f of files) form.append("files", f);

      let runId: string;
      try {
        const resp = await fetch("/api/agent/run", { method: "POST", body: form });
        if (!resp.ok) {
          const body = (await resp.json()) as ApiError;
          setState((prev) => ({ ...prev, status: "error", error: body }));
          return null;
        }
        const data = await resp.json();
        runId = data.run_id;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: { kind: "internal_error", message: "Could not reach the backend. Is uvicorn running?" },
        }));
        return null;
      }

      setState((prev) => ({ ...prev, runId, status: "running" }));

      const es = new EventSource(`/api/agent/stream/${runId}`);
      eventSourceRef.current = es;

      es.addEventListener("update", (evt) => {
        const payload = JSON.parse((evt as MessageEvent).data);
        const { node, ...update } = payload;
        setState((prev) => {
          const next = { ...prev };
          if (update.scratchpad) {
            next.scratchpad = [...prev.scratchpad, ...update.scratchpad];
            const last = update.scratchpad[update.scratchpad.length - 1];
            next.currentStatusLine = statusLineFor(node, last?.thought ?? "");
          }
          if (update.evidence) next.evidence = [...prev.evidence, ...update.evidence];
          if (update.plan) next.plan = update.plan;
          if (update.goal_type) next.goalType = update.goal_type;
          if (update.final_answer) next.finalAnswer = update.final_answer;
          if (typeof update.loops_this_step === "number" && update.loops_this_step > 0) {
            next.retries = prev.retries + 1;
          }
          next.stepsUsed = prev.stepsUsed + 1;
          return next;
        });
      });

      es.addEventListener("error", (evt) => {
        try {
          const payload = JSON.parse((evt as MessageEvent).data);
          setState((prev) => ({
            ...prev,
            status: "error",
            error: { kind: "internal_error", message: payload.message },
          }));
        } catch {
          // connection-level error, not a payload — ignore, "done" or retry will follow
        }
      });

      es.addEventListener("done", async () => {
        es.close();
        await fetchFinalResult(runId);
        setState((prev) => ({ ...prev, currentStatusLine: "" }));
      });

      return runId;
    },
    [reset, fetchFinalResult]
  );

  const loadRun = useCallback(
    async (runId: string) => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setState({ ...INITIAL_STATE, runId, status: "running" });
      await fetchFinalResult(runId);
    },
    [fetchFinalResult]
  );

  return { ...state, startRun, reset, loadRun };
}
