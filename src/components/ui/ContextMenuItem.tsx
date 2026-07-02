import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "./SharedIcons";

export const contextMenuItemHoverEvent = "athenaeum:context-menu-item-hover";
export const ContextMenuScopeContext = createContext<"root" | "submenu">("root");

export interface ContextMenuItemProps {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  variant?: "default" | "danger";
  hasSubmenu?: boolean;
  disabled?: boolean;
}

export function ContextMenuItem({ icon, label, onSelect, variant = "default", hasSubmenu = false, disabled = false }: ContextMenuItemProps) {
  const scope = useContext(ContextMenuScopeContext);
  const toneClassName = variant === "danger" ? "text-status-red" : "text-text-primary";

  return (
    <button
      type="button"
      disabled={disabled}
      className={`flex h-9 w-full items-center gap-2.5 px-[14px] text-left text-sm transition-colors duration-100 hover:bg-sidebar-raised ${toneClassName} ${
        disabled ? "pointer-events-none opacity-40" : ""
      }`}
      onMouseEnter={() => {
        if (scope === "root") {
          window.dispatchEvent(new Event(contextMenuItemHoverEvent));
        }
      }}
      onClick={onSelect}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hasSubmenu ? <ChevronRightIcon className="ml-auto shrink-0" size={16} /> : null}
    </button>
  );
}
