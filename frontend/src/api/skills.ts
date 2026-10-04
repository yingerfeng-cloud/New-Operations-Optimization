import { apiClient, unwrap } from './client';

export interface PlatformSkill {
  skill_name: string;
  canonical_skill_name?: string;
  display_name?: string;
  name?: string;
  description?: string;
  model_id?: string;
  model_code?: string;
  model_version?: string;
  version?: string;
  status?: string;
  skill_status?: string;
  callable?: boolean;
  callable_reason?: string;
  agent_enabled?: boolean;
  agent_skill_name?: string;
  has_agent_package?: boolean;
  agent_package_status?: string;
  input_schema?: SkillInputField[];
  output_schema?: Record<string, unknown>;
  input_parameter_count?: number;
  output_field_count?: number;
  last_invocation_at?: string;
  success_rate?: number | null;
  avg_duration_ms?: number;
  endpoint?: string;
  method?: string;
  owner?: string;
  tags?: string[];
  execution_policy?: string;
  requires_human_review?: boolean;
  generated?: boolean;
  binding_policy?: string;
  definition_revision?: number;
  definition_hash?: string;
  definition?: SkillDefinition | null;
  explanation_spec?: Record<string, unknown> | null;
  definition_validation?: SkillValidation;
  [key: string]: unknown;
}

export interface SkillValidation {
  status?: 'valid' | 'invalid' | 'not_generated' | string;
  score?: number | null;
  errors?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  validated_at?: string;
}

export interface SkillDefinition {
  schema_version?: string;
  revision?: number;
  skill_name?: string;
  display_name?: string;
  description?: string;
  model_binding?: Record<string, unknown>;
  input_schema?: SkillInputField[];
  output_schema?: Record<string, unknown>;
  instructions?: string[];
  trigger_examples?: string[];
  non_trigger_examples?: string[];
  parameter_questions?: Array<Record<string, unknown>>;
  explanation_spec?: Record<string, unknown>;
  execution_policy?: Record<string, unknown>;
  generation?: Record<string, unknown>;
  validation?: SkillValidation;
  definition_hash?: string;
  [key: string]: unknown;
}

export interface SkillInputField {
  key?: string;
  name?: string;
  type?: string;
  required?: boolean;
  default_value?: unknown;
  sample_value?: unknown;
  description?: string;
  unit?: string;
  dimension?: string[];
  validation?: Record<string, unknown>;
  [key: string]: unknown;
}

export const getSkills = () => unwrap<PlatformSkill[]>(apiClient.get('/api/skills'));
export const getSkill = (name: string) => unwrap<PlatformSkill>(apiClient.get(`/api/skills/${encodeURIComponent(name)}`));
export const runSkill = (name: string, parameters: Record<string, unknown>, options: Record<string, unknown> = { mode: 'sync', explain: true }) =>
  unwrap<Record<string, unknown>>(apiClient.post(`/api/skills/${encodeURIComponent(name)}/run`, { parameters, options }));
export const enableSkill = (name: string) => unwrap<PlatformSkill>(apiClient.post(`/api/skills/${encodeURIComponent(name)}/enable`));
export const disableSkill = (name: string) => unwrap<PlatformSkill>(apiClient.post(`/api/skills/${encodeURIComponent(name)}/disable`));
export const previewModelSkill = (modelId: string, options: { use_llm?: boolean } = {}) =>
  unwrap<{ model_id: string; skill_name: string; definition: SkillDefinition; validation: SkillValidation; persisted: false }>(apiClient.post(`/api/models/${encodeURIComponent(modelId)}/skills/preview`, options));
export const generateModelSkill = (modelId: string, options: { use_llm?: boolean; status?: string } = {}) =>
  unwrap<PlatformSkill>(apiClient.post(`/api/models/${encodeURIComponent(modelId)}/skills/generate`, options));
export const updateSkill = (name: string, body: { definition?: SkillDefinition; description?: string; status?: string; save_invalid_draft?: boolean }) =>
  unwrap<PlatformSkill>(apiClient.put(`/api/skills/${encodeURIComponent(name)}`, body));
export const validateSkill = (name: string, definition?: SkillDefinition) =>
  unwrap<SkillValidation>(apiClient.post(`/api/skills/${encodeURIComponent(name)}/validate`, definition ? { definition } : {}));
export const getSkillVersions = (name: string) =>
  unwrap<Array<Record<string, unknown>>>(apiClient.get(`/api/skills/${encodeURIComponent(name)}/versions`));
export const createAgentSkill = (name: string) => unwrap<Record<string, unknown>>(apiClient.post(`/api/skills/${encodeURIComponent(name)}/create-agent-skill`, {}));
export const getSkillInvocations = (name: string) => unwrap<Record<string, unknown>[]>(apiClient.get(`/api/skills/${encodeURIComponent(name)}/invocations`));
