/* eslint-disable react-refresh/only-export-components -- the slot hooks share this context with the provider */
import { createContext, useContext, useState, type ReactNode } from 'react';

const TitlebarSlotContext = createContext<HTMLElement | null>(null);
const TitlebarSlotSetterContext = createContext<(element: HTMLElement | null) => void>(() => {});

/** Shares the titlebar tab mount point between the toolbar and terminal groups. */
export function TitlebarSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <TitlebarSlotSetterContext.Provider value={setSlot}>
      <TitlebarSlotContext.Provider value={slot}>{children}</TitlebarSlotContext.Provider>
    </TitlebarSlotSetterContext.Provider>
  );
}

export function useTitlebarSlot(): HTMLElement | null {
  return useContext(TitlebarSlotContext);
}

export function useTitlebarSlotSetter(): (element: HTMLElement | null) => void {
  return useContext(TitlebarSlotSetterContext);
}
