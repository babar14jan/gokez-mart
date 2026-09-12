import { createContext, useContext, useState, ReactNode } from 'react';

interface HeaderActionContextType {
  onAction: (() => void) | null;
  label: string;
  setHeaderAction: (label: string, fn: () => void) => void;
  clearHeaderAction: () => void;
}

const HeaderActionContext = createContext<HeaderActionContextType>({
  onAction: null,
  label: '',
  setHeaderAction: () => {},
  clearHeaderAction: () => {},
});

export function HeaderActionProvider({ children }: { children: ReactNode }) {
  const [onAction, setOnAction] = useState<(() => void) | null>(null);
  const [label, setLabel] = useState('');

  const setHeaderAction = (lbl: string, fn: () => void) => {
    setLabel(lbl);
    setOnAction(() => fn);
  };
  const clearHeaderAction = () => { setOnAction(null); setLabel(''); };

  return (
    <HeaderActionContext.Provider value={{ onAction, label, setHeaderAction, clearHeaderAction }}>
      {children}
    </HeaderActionContext.Provider>
  );
}

export const useHeaderAction = () => useContext(HeaderActionContext);
