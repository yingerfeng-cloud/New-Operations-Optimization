export type ScenarioStatus = 'draft' | 'trial' | 'published' | 'offline';

export interface ScenarioCatalogItem {
  id: string;
  name: string;
  description: string;
  status: ScenarioStatus;
}
