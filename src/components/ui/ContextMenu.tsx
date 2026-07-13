import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ContextMenuScopeContext } from "./ContextMenuItem";

type ContextMenuProps = {
  isOpen: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
};

const viewportMargin = 8;

export function ContextMenu({ isOpen, x, y, children }: ContextMenuProps) {
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
  }, [isOpen, x, y]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <ContextMenuScopeContext.Provider value="root">
      <div
        ref={menuRef}
        data-context-menu-root="true"
        className="fixed w-[220px] py-[5px] text-text-primary"
        style={{
          left: position.left,
          top: position.top,
          zIndex: 9999,
          background: "var(--color-surface-card)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)",
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </ContextMenuScopeContext.Provider>,
    document.body,
  );
}
