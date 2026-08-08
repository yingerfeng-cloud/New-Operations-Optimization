export interface AgentMessage {
  role?: string;
  text?: string;
  content?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface AgentConversationPayload {
  title?: string;
  messages?: AgentMessage[];
  status?: string;
  [key: string]: unknown;
}

export interface AgentConversationSummary {
  conversation_id: string;
  title?: string;
  updated_at?: string;
  last_message?: string;
  status?: string;
  active_run_id?: string;
  active_run_status?: AgentRunStatus;
  [key: string]: unknown;
}

export interface AgentConversation extends AgentConversationSummary {
  created_at?: string;
  messages?: AgentMessage[];
  agent_skill_name?: string;
  resolved_skill_name?: string;
  parameter_draft?: Record<string, unknown>;
  active_run?: AgentRun;
  runs?: AgentRun[];
}

export type AgentRunStatus =
  | 'DRAFT'
  | 'ROUTING'
  | 'CLARIFICATION'
  | 'PARAMETER_REVIEW'
  | 'APPROVAL_REQUIRED'
  | 'READY'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export interface AgentRunEvent {
  event_id: string;
  sequence: number;
  type: string;
  status?: AgentRunStatus;
  title: string;
  detail?: string;
  created_at?: string;
  payload?: Record<string, unknown>;
}

export interface AgentRun {
  run_id: string;
  conversation_id: string;
  title?: string;
  status: AgentRunStatus;
  workflow_state?: string;
  agent_skill_name?: string;
  api_skill_name?: string;
  model_id?: string;
  intent?: string;
  response_type?: string;
  parameter_draft?: Record<string, unknown>;
  parameter_sources?: Record<string, unknown>;
  missing_required?: Array<Record<string, unknown> | string>;
  invalid_parameters?: unknown[];
  default_candidates?: unknown[];
  ready_to_invoke?: boolean;
  invocation_id?: string;
  task_id?: string;
  result?: Record<string, unknown>;
  objective_value?: number;
  route_confidence?: number;
  selection_reason?: string;
  message?: string;
  error?: string;
  created_at?: string;
  updated_at?: string;
  events?: AgentRunEvent[];
}

export interface AgentSkill {
  name?: string;
  skill_name?: string;
  display_name?: string;
  description?: string;
  enabled?: boolean;
  input_schema?: Array<Record<string, unknown>>;
  required_parameters?: string[];
  optional_parameters?: string[];
  schema_version?: string;
  state?: string;
  business_domain?: Record<string, unknown>;
  supported_intents?: string[];
  business_goals?: string[];
  positive_examples?: string[];
  negative_examples?: string[];
  do_not_invoke_examples?: string[];
  explanation_profile?: string;
  quality_score?: number;
  validation?: {
    status?: string;
    quality_score?: number;
    errors?: unknown[];
    warnings?: unknown[];
  };
  [key: string]: unknown;
}

export interface AgentStatus {
  agent?: Record<string, unknown>;
  platform?: {
    base_url?: string;
    reachable?: boolean;
    health_ok?: boolean;
    skill_registry_ok?: boolean;
    skill_count?: number;
    last_error?: string;
    [key: string]: unknown;
  };
  llm?: {
    enabled?: boolean;
    api_key_configured?: boolean;
    provider?: string;
    model?: string;
    fallback_mode?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AgentTaskSession {
  task_id?: string;
  status?: string;
  model_id?: string;
  result?: unknown;
  [key: string]: unknown;
}

export interface AgentAnalyzePayload {
  conversation_id?: string;
  message?: string;
  text?: string;
  agent_skill_name?: string;
  skill_name?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AgentInvokePayload {
  conversation_id: string;
  run_id?: string;
  idempotency_key?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AgentDefaultsPayload {
  conversation_id: string;
  run_id?: string;
  agent_skill_name?: string;
  [key: string]: unknown;
}

export interface AgentAnalyzeResponse {
  conversation_id?: string;
  response_type?: string;
  intent?: string;
  workflow_state?: string;
  status?: string;
  message?: string;
  agent_message?: string;
  agent_skill_name?: string;
  api_skill_name?: string;
  resolved_skill_name?: string;
  normalized_parameters?: Record<string, unknown>;
  parameter_draft?: Record<string, unknown>;
  parameter_sources?: Record<string, unknown>;
  parameter_completeness?: number;
  schema_fit_score?: number;
  parameter_confidence?: Record<string, number>;
  missing_required?: Array<Record<string, unknown> | string>;
  invalid_parameters?: unknown[];
  can_use_default?: unknown[];
  requires_default_confirmation?: boolean;
  ready_to_invoke?: boolean;
  task_session?: AgentTaskSession;
  result?: Record<string, unknown>;
  objective_value?: number;
  explanation?: unknown;
  route_confidence?: number;
  candidate_skills?: Array<Record<string, unknown>>;
  selection_reason?: string;
  needs_clarification?: boolean;
  clarification_question?: string;
  invocation_id?: string;
  run_id?: string;
  run?: AgentRun;
  idempotent_replay?: boolean;
  already_running?: boolean;
  [key: string]: unknown;
}
