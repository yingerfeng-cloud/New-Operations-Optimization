import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const PageHeaderSlotsContext = createContext<{
  pageLabel?: string;
  titleTarget: HTMLDivElement | null;
  setTitleTarget: (target: HTMLDivElement | null) => void;
} | null>(null);

export function PageHeaderSlotsProvider({ children, pageLabel }: { children: ReactNode; pageLabel?: string }) {
  const [titleTarget, setTitleTarget] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ titleTarget, setTitleTarget, pageLabel }), [titleTarget, pageLabel]);
  return <PageHeaderSlotsContext.Provider value={value}>{children}</PageHeaderSlotsContext.Provider>;
}

export const usePageHeaderSlots = () => useContext(PageHeaderSlotsContext);
