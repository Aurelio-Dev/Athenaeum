import { useCallback, useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
}

export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  const close = useCallback(() => {
    setState((current) => (current.isOpen ? { ...current, isOpen: false } : current));
  }, []);

  const open = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setState({
      isOpen: true,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const openAt = useCallback((x: number, y: number) => {
    setState({
      isOpen: true,
      x,
      y,
    });
  }, []);

  useEffect(() => {
    if (!state.isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [close, state.isOpen]);

  return {
    ...state,
    open,
    openAt,
    close,
  };
}
