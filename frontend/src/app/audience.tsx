import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type PlatformAudience = 'business' | 'expert';
const STORAGE_KEY = 'copt.platform.audience';

const AudienceContext = createContext<{ audience: PlatformAudience; setAudience: (value: PlatformAudience) => void } | undefined>(undefined);

export function AudienceProvider({ children }: { children: ReactNode }) {
  const [audience, setAudienceState] = useState<PlatformAudience>(() => localStorage.getItem(STORAGE_KEY) === 'expert' ? 'expert' : 'business');
  const value = useMemo(() => ({ audience, setAudience: (next: PlatformAudience) => { setAudienceState(next); localStorage.setItem(STORAGE_KEY, next); } }), [audience]);
  return <AudienceContext.Provider value={value}>{children}</AudienceContext.Provider>;
}

export function useAudience() {
  const value = useContext(AudienceContext);
  if (!value) throw new Error('useAudience must be used inside AudienceProvider');
  return value;
}
