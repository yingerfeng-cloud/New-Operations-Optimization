export interface DictionaryItem {
  code: string;
  label: string;
  parent_code?: string;
  enabled: boolean;
  sort_order: number;
}

export interface SystemDictionaries {
  business_scenarios: DictionaryItem[];
  component_domains: DictionaryItem[];
  component_categories: DictionaryItem[];
}

export interface SystemConfig {
  version?: string;
  updated_at?: string | null;
  dictionaries: SystemDictionaries;
}

export interface LlmConfig {
  provider: string;
  base_url: string;
  model: string;
  timeout_seconds: number;
  temperature: number;
  max_tokens: number;
  enabled: boolean;
  api_key_configured: boolean;
  supported_providers: string[];
  persistence_path?: string;
  config_source?: string;
  last_updated_at?: string | null;
}

export interface LlmTestResult {
  ok: boolean;
  enabled: boolean;
  message?: string;
  diagnostics?: Record<string, unknown>;
  config?: Partial<LlmConfig>;
  response?: Record<string, unknown>;
}
