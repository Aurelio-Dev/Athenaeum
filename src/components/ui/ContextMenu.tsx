import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ContextMenuA11yContext, ContextMenuScopeContext } from "./ContextMenuItem";

type ContextMenuProps = {
  isOpen: boolean;
  x: number;
  y: number;
  onClose: () => void;
  autoFocus?: boolean;
  width?: number;
  maxHeight?: number;
  children: ReactNode;
};

const viewportMargin = 8;

const accessibleItemSelector =
  '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)';

export function ContextMenu({
  isOpen,
  x,
  y,
  onClose,
  autoFocus = false,
  width = 220,
  maxHeight,
  children,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Unico efeito de posicionamento: mede o menu ja renderizado e clampa na
  // viewport ANTES do paint. (Nao adicionar um useEffect espelhado com a
  // posicao crua — ele rodaria depois deste e desfaria o clamp, deixando o
  // menu vazar da tela quando aberto perto das bordas.)
  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - viewportMargin;
    const maxTop = window.innerHeight - rect.height - viewportMargin;

    setPosition({
      left: Math.max(viewportMargin, Math.min(x, maxLeft)),
      top: Math.max(viewportMargin, Math.min(y, maxTop)),
    });

    if (autoFocus) {
      menuRef.current.querySelector<HTMLButtonElement>(accessibleItemSelector)?.focus({ preventScroll: true });
    }
  }, [autoFocus, isOpen, x, y]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(accessibleItemSelector),
    );
    if (items.length === 0) {
      return;
    }

    const activeIndex = items.findIndex((item) => item === window.document.activeElement);
    let nextIndex = 0;

    if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = activeIndex < 0 ? items.length - 1 : (activeIndex - 1 + items.length) % items.length;
    }

    event.preventDefault();
    items[nextIndex]?.focus({ preventScroll: true });
  }

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <ContextMenuScopeContext.Provider value="root">
      <ContextMenuA11yContext.Provider value={autoFocus}>
        <div
          ref={menuRef}
          data-context-menu-root="true"
          role={autoFocus ? "menu" : undefined}
          aria-orientation={autoFocus ? "vertical" : undefined}
          className="material-liquid-overlay fixed overflow-y-auto rounded-[10px] border border-border-subtle bg-surface-card py-[5px] text-text-primary shadow-[0_8px_24px_rgba(0,0,0,0.10),0_2px_6px_rgba(0,0,0,0.06)]"
          style={{
            left: position.left,
            top: position.top,
            width,
            maxHeight: Math.min(maxHeight ?? window.innerHeight - viewportMargin * 2, window.innerHeight - viewportMargin * 2),
            zIndex: 9999,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          {children}
        </div>
      </ContextMenuA11yContext.Provider>
    </ContextMenuScopeContext.Provider>,
    document.body,
  );
}
