import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon } from "./SharedIcons";
import { ContextMenuItem, ContextMenuScopeContext, contextMenuItemHoverEvent } from "./ContextMenuItem";

interface ContextMenuSubmenuProps {
  icon: ReactNode;
  label: string;
  collections: Array<{ id: string; name: string; color: string }>;
  onSelect: (collectionId: string) => void;
  onClose: () => void;
}

const submenuWidth = 220;
const viewportMargin = 8;

export function ContextMenuSubmenu({ icon, label, collections, onSelect, onClose }: ContextMenuSubmenuProps) {
  const parentRef = useRef<HTMLButtonElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const isPointerInsideSubmenuRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  function clearOpenTimer() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function measurePosition() {
    const parentRect = parentRef.current?.getBoundingClientRect();
    const rootRect = parentRef.current?.closest("[data-context-menu-root='true']")?.getBoundingClientRect();

    if (!parentRect || !rootRect) {
      return;
    }

    const opensLeft = rootRect.right + submenuWidth + viewportMargin > window.innerWidth;
    setPosition({
      left: opensLeft ? rootRect.left - submenuWidth : rootRect.right,
      top: parentRect.top,
    });
  }

  function scheduleOpen() {
    clearOpenTimer();
    clearCloseTimer();
    openTimerRef.current = window.setTimeout(() => {
      measurePosition();
      setIsOpen(true);
    }, 150);
  }

  function scheduleClose() {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      if (!isPointerInsideSubmenuRef.current) {
        setIsOpen(false);
      }
    }, 300);
  }

  useEffect(() => {
    function closeFromSiblingItem() {
      setIsOpen(false);
    }

    window.addEventListener(contextMenuItemHoverEvent, closeFromSiblingItem);
    return () => {
      clearOpenTimer();
      clearCloseTimer();
      window.removeEventListener(contextMenuItemHoverEvent, closeFromSiblingItem);
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !submenuRef.current) {
      return;
    }

    const rect = submenuRef.current.getBoundingClientRect();
    setPosition((current) => ({
      left: Math.max(viewportMargin, Math.min(current.left, window.innerWidth - rect.width - viewportMargin)),
      top: Math.max(viewportMargin, Math.min(current.top, window.innerHeight - rect.height - viewportMargin)),
    }));
  }, [isOpen]);

  return (
    <>
      <button
        ref={parentRef}
        type="button"
        className="flex h-9 w-full items-center gap-2.5 px-[14px] text-left text-sm text-text-primary transition-colors duration-100 hover:bg-sidebar-raised"
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRightIcon className="ml-auto shrink-0" size={16} />
      </button>

      {isOpen
        ? createPortal(
            <ContextMenuScopeContext.Provider value="submenu">
              <div
                ref={submenuRef}
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
                onMouseEnter={() => {
                  isPointerInsideSubmenuRef.current = true;
                  clearCloseTimer();
                }}
                onMouseLeave={() => {
                  isPointerInsideSubmenuRef.current = false;
                  setIsOpen(false);
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {collections.length === 0 ? (
                  <ContextMenuItem icon={<span className="h-2 w-2 rounded-full bg-surface-muted" />} label="Nenhuma coleção" onSelect={() => undefined} disabled />
                ) : (
                  collections.map((collection) => (
                    <ContextMenuItem
                      key={collection.id}
                      icon={<span className="h-2 w-2 rounded-full" style={{ backgroundColor: collection.color }} />}
                      label={collection.name}
                      onSelect={() => {
                        onSelect(collection.id);
                        onClose();
                      }}
                    />
                  ))
                )}
              </div>
            </ContextMenuScopeContext.Provider>,
            document.body,
          )
        : null}
    </>
  );
}
