'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

type VoiceModeShellContextValue = {
  searchDialogOpen: boolean;
  setSearchDialogOpen: Dispatch<SetStateAction<boolean>>;
};

const VoiceModeShellContext = createContext<VoiceModeShellContextValue | null>(
  null,
);

export function VoiceModeShellProvider({ children }: { children: ReactNode }) {
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const value = useMemo(
    () => ({ searchDialogOpen, setSearchDialogOpen }),
    [searchDialogOpen],
  );
  return (
    <VoiceModeShellContext.Provider value={value}>
      {children}
    </VoiceModeShellContext.Provider>
  );
}

export function useVoiceModeShell() {
  const ctx = useContext(VoiceModeShellContext);
  if (!ctx) {
    throw new Error('useVoiceModeShell must be used within VoiceModeShellProvider');
  }
  return ctx;
}
