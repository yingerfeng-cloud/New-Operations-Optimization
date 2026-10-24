import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const PageHeaderSlotsContext = createContext<{
  titleTarget: HTMLDivElement | null;
  setTitleTarget: (target: HTMLDivElement | null) => void;
} | null>(null);

export function PageHeaderSlotsProvider({ children }: { children: ReactNode }) {
  const [titleTarget, setTitleTarget] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ titleTarget, setTitleTarget }), [titleTarget]);
  return <PageHeaderSlotsContext.Provider value={value}>{children}</PageHeaderSlotsContext.Provider>;
}

export const usePageHeaderSlots = () => useContext(PageHeaderSlotsContext);
