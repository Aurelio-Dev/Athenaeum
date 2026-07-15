import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "./SharedIcons";

export const contextMenuItemHoverEvent = "athenaeum:context-menu-item-hover";
export const ContextMenuScopeContext = createContext<"root" | "submenu">("root");
export const ContextMenuA11yContext = createContext(false);

export interface ContextMenuItemProps {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  variant?: "default" | "danger";
  hasSubmenu?: boolean;
  disabled?: boolean;
  checked?: boolean;
  selectionMode?: "radio" | "checkbox";
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

export function ContextMenuItem({
  icon,
  label,
  onSelect,
  variant = "default",
  hasSubmenu = false,
  disabled = false,
  checked,
  selectionMode = "checkbox",
}: ContextMenuItemProps) {
  const scope = useContext(ContextMenuScopeContext);
  const isAccessibleMenu = useContext(ContextMenuA11yContext);
  const toneClassName = variant === "danger" ? "text-status-red" : "text-text-primary";
  const accessibleRole = !isAccessibleMenu
    ? undefined
    : checked === undefined
      ? "menuitem"
      : selectionMode === "radio"
        ? "menuitemradio"
        : "menuitemcheckbox";

  return (
    <button
      type="button"
      role={accessibleRole}
      aria-checked={checked === undefined ? undefined : checked}
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
      {checked !== undefined ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-primary">
          {checked ? <CheckIcon /> : null}
        </span>
      ) : null}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hasSubmenu ? <ChevronRightIcon className="ml-auto shrink-0" size={16} /> : null}
    </button>
  );
}
