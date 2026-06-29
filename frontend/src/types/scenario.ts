import type { BuildMode } from './model';

export type ScenarioStatus = 'draft' | 'trial' | 'published';

export interface ScenarioCatalogItem {
  id: string;
  name: string;
  description: string;
  status: ScenarioStatus;
  models: ScenarioModelItem[];
}

export interface ScenarioModelItem {
  id: string;
  name: string;
  code: string;
  builderMode: Extract<BuildMode, 'generic_linear' | 'component_based'>;
  problemType: string;
  paradigmSummary: string;
  objectiveSummary: string;
  setSummary: string;
  description: string;
  templateCode?: string;
}
