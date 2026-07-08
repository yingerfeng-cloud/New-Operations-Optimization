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
export const syncSkillSchema = (name: string) => unwrap<PlatformSkill>(apiClient.post(`/api/skills/${encodeURIComponent(name)}/sync-schema`));
export const createAgentSkill = (name: string) => unwrap<Record<string, unknown>>(apiClient.post(`/api/skills/${encodeURIComponent(name)}/create-agent-skill`, {}));
export const getSkillInvocations = (name: string) => unwrap<Record<string, unknown>[]>(apiClient.get(`/api/skills/${encodeURIComponent(name)}/invocations`));
