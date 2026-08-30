import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  KEYBOARD_SHORTCUTS_CHANGED_EVENT,
  getShortcutOverrides,
  isKeyboardShortcutsChangedPayload,
  setShortcutOverrides,
  type DatabaseHandleSource,
} from "../lib/database";
import {
  bindingsEqual,
  findShortcut,
  matchesBinding,
  normalizeShortcutOverrides,
  resolveShortcutBindings,
  validateBinding,
  type BindingRejection,
  type ShortcutBinding,
  type ShortcutBindings,
  type ShortcutOverrides,
} from "../lib/keyboardShortcuts";

const overridesCacheStorageKey = "athenaeum-keyboard-shortcuts-v1";

export type KeyboardShortcutsContextValue = {
  bindings: ShortcutBindings;
  overrides: ShortcutOverrides;
  // Verdadeiro quando o evento casa com o atalho `id`. Handlers consultam
  // isto em vez de comparar teclas literalmente.
  matchesShortcut: (id: string, event: KeyboardEvent | { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) => boolean;
  setShortcutBinding: (id: string, binding: ShortcutBinding) => BindingRejection | null;
  resetShortcutBinding: (id: string) => void;
  resetAllShortcutBindings: () => void;
};

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

function readCachedOverrides(): ShortcutOverrides {
  try {
    return normalizeShortcutOverrides(window.localStorage.getItem(overridesCacheStorageKey));
  } catch {
    return {};
  }
}

function writeCachedOverrides(overrides: ShortcutOverrides) {
  try {
    window.localStorage.setItem(
      overridesCacheStorageKey,
      JSON.stringify({ version: 1, bindings: overrides }),
    );
  } catch (error) {
    console.warn("Nao foi possivel atualizar o cache dos atalhos.", error);
  }
}

export function KeyboardShortcutsProvider({
  children,
  databaseSource = "loaded",
}: {
  children: ReactNode;
  databaseSource?: DatabaseHandleSource;
}) {
  const [overrides, setOverrides] = useState<ShortcutOverrides>(readCachedOverrides);
  // Uma alteracao local feita antes da leitura inicial terminar nao pode ser
  // desfeita por ela — mesma protecao do provider de Aparencia.
  const hasLocalChangeRef = useRef(false);

  useEffect(() => {
    writeCachedOverrides(overrides);
  }, [overrides]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const removeListener = await listen<unknown>(KEYBOARD_SHORTCUTS_CHANGED_EVENT, (event) => {
          if (!isKeyboardShortcutsChangedPayload(event.payload)) {
            return;
          }
          setOverrides(normalizeShortcutOverrides({
            version: 1,
            bindings: event.payload.overrides,
          }));
        });
        if (disposed) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      } catch (error) {
        console.warn("Nao foi possivel sincronizar os atalhos entre as janelas.", error);
      }

      if (disposed) {
        return;
      }

      try {
        const loaded = await getShortcutOverrides(databaseSource);
        if (!disposed && !hasLocalChangeRef.current) {
          setOverrides(loaded);
        }
      } catch (error) {
        console.warn("Nao foi possivel carregar os atalhos personalizados.", error);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [databaseSource]);

  const bindings = useMemo(() => resolveShortcutBindings(overrides), [overrides]);

  const persist = useCallback((next: ShortcutOverrides) => {
    hasLocalChangeRef.current = true;
    setOverrides(next);
    void setShortcutOverrides(next, databaseSource).catch((error: unknown) => {
      console.error("Nao foi possivel salvar os atalhos personalizados.", error);
    });
  }, [databaseSource]);

  const setShortcutBinding = useCallback((id: string, binding: ShortcutBinding) => {
    const rejeicao = validateBinding(id, binding, bindings);
    if (rejeicao) {
      return rejeicao;
    }

    const padrao = findShortcut(id)?.defaultBinding;
    const proximo = { ...overrides };
    // Voltar manualmente ao padrao equivale a remover o override.
    if (padrao && bindingsEqual(padrao, binding)) {
      delete proximo[id];
    } else {
      proximo[id] = binding;
    }

    persist(proximo);
    return null;
  }, [bindings, overrides, persist]);

  const resetShortcutBinding = useCallback((id: string) => {
    if (!(id in overrides)) {
      return;
    }

    const proximo = { ...overrides };
    delete proximo[id];
    persist(proximo);
  }, [overrides, persist]);

  const resetAllShortcutBindings = useCallback(() => {
    if (Object.keys(overrides).length === 0) {
      return;
    }
    persist({});
  }, [overrides, persist]);

  const matchesShortcut = useCallback<KeyboardShortcutsContextValue["matchesShortcut"]>(
    (id, event) => {
      const binding = bindings[id];
      return binding !== undefined && matchesBinding(event, binding);
    },
    [bindings],
  );

  const value = useMemo<KeyboardShortcutsContextValue>(() => ({
    bindings,
    overrides,
    matchesShortcut,
    setShortcutBinding,
    resetShortcutBinding,
    resetAllShortcutBindings,
  }), [
    bindings,
    matchesShortcut,
    overrides,
    resetAllShortcutBindings,
    resetShortcutBinding,
    setShortcutBinding,
  ]);

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcuts() {
  const context = useContext(KeyboardShortcutsContext);

  if (!context) {
    throw new Error("useKeyboardShortcuts deve ser usado dentro de ThemeProvider.");
  }

  return context;
}

export const KEYBOARD_SHORTCUTS_CACHE_STORAGE_KEY = overridesCacheStorageKey;
