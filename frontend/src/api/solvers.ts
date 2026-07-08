import { apiClient, unwrap } from './client';

export interface SolverStatusResponse {
  highs: {
    available: boolean;
    version?: string | null;
  };
  ipopt: {
    available: boolean;
    path?: string | null;
    version?: string | null;
    pyomo_available?: boolean;
    message?: string | null;
  };
  status?: string;
  message?: string | null;
}

export async function getSolverStatus() {
  return unwrap<SolverStatusResponse>(apiClient.get('/api/solvers/status', { suppressErrorToast: true, timeout: 5000 }));
}
