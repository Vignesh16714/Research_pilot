export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export type GoalType = "comparison" | "lit_review" | "general";

export type RunStatus = "pending" | "running" | "done" | "error";

export interface ScratchpadEntry {
  node: string;
  thought: string;
  tool_call: string | null;
  tool_result: string | null;
  timestamp: string;
}

export interface EvidenceItem {
  step_index: number;
  source_type: "web" | "pdf";
  title: string;
  url: string | null;
  filename: string | null;
  page: number | null;
  snippet: string;
}

export interface RunResult {
  run_id: string;
  status: RunStatus;
  goal: string;
  goal_type: GoalType | null;
  plan: string[];
  final_answer: string | null;
  evidence: EvidenceItem[];
  scratchpad: ScratchpadEntry[];
  error: string | null;
  steps_used: number;
  retries: number;
}

export interface UploadedDocument {
  document_id: string;
  filename: string;
  num_pages: number;
}

export interface ApiError {
  kind: "quota_exceeded" | "config_error" | "not_found" | "bad_request" | "internal_error";
  message: string;
}

export interface HistoryItem {
  run_id: string;
  goal: string;
  startedAt: number;
  status: RunStatus;
}
