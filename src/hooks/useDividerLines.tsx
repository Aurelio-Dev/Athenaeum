import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSetting, setSetting } from "../lib/database";

const dividerLinesSettingKey = "show_divider_lines";
const hiddenDividersClassName = "athenaeum-hide-dividers";

type DividerLinesContextValue = {
  showDividerLines: boolean;
  setShowDividerLines: (showDividerLines: boolean) => void;
};

const DividerLinesContext = createContext<DividerLinesContextValue | null>(null);

function parseStoredValue(value: string | null) {
  return value === "false" ? false : true;
}

export function DividerLinesProvider({ children }: { children: ReactNode }) {
  const [showDividerLines, setShowDividerLinesState] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const storedValue = await getSetting(dividerLinesSettingKey).catch(() => null);
      if (!cancelled) {
        setShowDividerLinesState(parseStoredValue(storedValue));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.document.documentElement.classList.toggle(hiddenDividersClassName, !showDividerLines);
  }, [showDividerLines]);

  const setShowDividerLines = useCallback((nextShowDividerLines: boolean) => {
    setShowDividerLinesState(nextShowDividerLines);
    void setSetting(dividerLinesSettingKey, nextShowDividerLines ? "true" : "false").catch((error: unknown) => {
      console.error("Nao foi possivel salvar a preferencia de linhas divisorias.", error);
    });
  }, []);

  const value = useMemo<DividerLinesContextValue>(
    () => ({ showDividerLines, setShowDividerLines }),
    [setShowDividerLines, showDividerLines],
  );

  return <DividerLinesContext.Provider value={value}>{children}</DividerLinesContext.Provider>;
}

export function useDividerLines() {
  const context = useContext(DividerLinesContext);

  if (!context) {
    throw new Error("useDividerLines deve ser usado dentro de DividerLinesProvider.");
  }

  return context;
}
