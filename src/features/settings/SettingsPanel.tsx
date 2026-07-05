import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { appDataDir } from "@tauri-apps/api/path";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useDividerLines } from "../../hooks/useDividerLines";
import { useTheme, type Theme } from "../../hooks/useTheme";
import { AppIconPreview, useAppIcon } from "../../lib/appIcon";

export const settingsPanelWidth = 720;
export const settingsPanelHeight = 560;
const settingsPanelMinWidth = 560;
const settingsPanelMinHeight = 360;
const collapsedHeight = 48;

type SettingsSectionId = "general" | "appearance" | "library" | "advanced";

const settingsSections: { id: SettingsSectionId; label: string }[] = [
  { id: "general", label: "Geral" },
  { id: "appearance", label: "Aparência" },
  { id: "library", label: "Biblioteca" },
  { id: "advanced", label: "Avançado" },
];

function getMaximizedPanelSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3 8h10" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 11V4a1 1 0 0 1 1-1h7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function SettingsSectionIcon({ sectionId }: { sectionId: SettingsSectionId }) {
  const commonProps = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (sectionId === "appearance") {
    return (
      <svg {...commonProps}>
        <path d="M15.5 4.5l4 4" />
        <path d="M13 7l4 4" />
        <path d="M4 20l4.5-1 9.5-9.5-3.5-3.5L5 15.5 4 20z" />
      </svg>
    );
  }

  if (sectionId === "library") {
    return (
      <svg {...commonProps}>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5z" />
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 8H20" />
      </svg>
    );
  }

  if (sectionId === "advanced") {
    return (
      <svg {...commonProps}>
        <path d="M8 9l-3 3 3 3" />
        <path d="M16 9l3 3-3 3" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M12 5v14" />
      <path d="M5 8h14" />
      <path d="M5 16h14" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

type SettingsPanelProps = {
  panel: FloatingPanel;
  onClose: () => void;
};

export function SettingsPanel({ panel, onClose }: SettingsPanelProps) {
  const { movePanel } = useFloatingPanels();
  const { theme, setTheme } = useTheme();
  const { variant: iconVariant, setVariant: chooseIconVariant } = useAppIcon();
  const { showDividerLines, setShowDividerLines } = useDividerLines();

  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: settingsPanelWidth, height: settingsPanelHeight });
  const restoreStateRef = useRef<{ position: { x: number; y: number }; size: { width: number; height: number }; collapsed: boolean } | null>(null);

  const [storagePath, setStoragePath] = useState("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const dir = await appDataDir().catch(() => "");

      if (!cancelled) {
        setStoragePath(dir);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCollapsed = useCallback(() => {
    if (isMaximized) {
      return;
    }
    setIsCollapsed((current) => !current);
  }, [isMaximized]);

  const toggleMaximized = useCallback(() => {
    if (isMaximized) {
      const restoreState = restoreStateRef.current;

      if (restoreState) {
        setPanelSize(restoreState.size);
        setIsCollapsed(restoreState.collapsed);
        movePanel(panel.id, restoreState.position);
      }

      setIsMaximized(false);
      return;
    }

    restoreStateRef.current = { position: panel.position, size: panelSize, collapsed: isCollapsed };
    setIsCollapsed(false);
    setPanelSize(getMaximizedPanelSize());
    movePanel(panel.id, { x: 0, y: 0 });
    setIsMaximized(true);
  }, [isCollapsed, isMaximized, movePanel, panel.id, panel.position, panelSize]);

  useEffect(() => {
    if (!isMaximized) {
      return;
    }

    function handleWindowResize() {
      setPanelSize(getMaximizedPanelSize());
      movePanel(panel.id, { x: 0, y: 0 });
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isMaximized, movePanel, panel.id]);

  const themeOptions: { value: Theme; label: string }[] = [
    { value: "light", label: "Claro" },
    { value: "dark", label: "Escuro" },
  ];

  return (
    <FloatingPanelFrame
      panel={panel}
      width={panelSize.width}
      height={isCollapsed ? collapsedHeight : panelSize.height}
      minWidth={settingsPanelMinWidth}
      minHeight={isCollapsed ? collapsedHeight : settingsPanelMinHeight}
      resizable={!isCollapsed && !isMaximized}
      edgeToEdge={isMaximized}
      renderHeader={(startDragging) => (
        <div
          className={`flex h-12 shrink-0 items-center justify-between border-b border-[var(--floating-header-border)] bg-[var(--floating-header-bg)] px-4 text-[var(--floating-header-text)] ${
            isMaximized ? "" : "cursor-move rounded-t-xl"
          }`}
          onMouseDown={isMaximized ? undefined : startDragging}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-[var(--floating-header-control)]">
              <GearIcon />
            </span>
            Ajustes
          </div>
          <div className="flex items-center gap-1" onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
              title={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
              className="rounded-md p-1.5 text-[var(--floating-header-muted)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={toggleCollapsed}
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              aria-label={isMaximized ? "Restaurar painel" : "Maximizar painel"}
              title={isMaximized ? "Restaurar painel" : "Maximizar painel"}
              className="rounded-md p-1.5 text-[var(--floating-header-muted)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={toggleMaximized}
            >
              {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button
              type="button"
              aria-label="Fechar painel"
              title="Fechar painel"
              className="rounded-md p-1.5 text-[var(--floating-header-muted)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
    >
      {isCollapsed ? null : (
        <div className="flex min-h-0 flex-1 bg-[var(--card)]">
          <nav className="flex w-40 shrink-0 flex-col gap-1 border-r border-border-subtle p-3" aria-label="Seções de ajustes">
            {settingsSections.map((section) => {
              const isActive = activeSection === section.id;

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={`flex h-9 items-center gap-2 rounded-lg px-3 text-left text-xs font-medium transition ${
                    isActive ? "bg-primary-soft text-primary" : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                  }`}
                >
                  <SettingsSectionIcon sectionId={section.id} />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
            {activeSection === "general" ? <EmptySettingsSection title="Geral" /> : null}

            {activeSection === "appearance" ? (
              <section className="flex max-w-[440px] flex-col gap-5">
                <h2 className="text-sm font-bold text-text-primary">Aparência</h2>

                <SettingsRow label="Tema">
                  <SegmentedControl<Theme> ariaLabel="Tema" options={themeOptions} value={theme} onChange={setTheme} />
                </SettingsRow>

                <SettingsRow label="Linhas divisórias">
                  <ToggleSwitch
                    checked={showDividerLines}
                    onCheckedChange={setShowDividerLines}
                    ariaLabel={showDividerLines ? "Ocultar linhas divisórias" : "Mostrar linhas divisórias"}
                  />
                </SettingsRow>

                <div className="flex flex-col gap-3 border-t border-border-subtle pt-5">
                  <span className="text-sm font-semibold text-text-primary">Ícone do app</span>
                  <div className="flex gap-4">
                    <IconVariantCard label="Frontão" selected={iconVariant === "frontao"} onSelect={() => chooseIconVariant("frontao")}>
                      <AppIconPreview variant="frontao" className="h-16 w-16" />
                    </IconVariantCard>

                    <IconVariantCard label="Coluna" selected={iconVariant === "coluna"} onSelect={() => chooseIconVariant("coluna")}>
                      <AppIconPreview variant="coluna" className="h-16 w-16" />
                    </IconVariantCard>
                  </div>
                </div>
              </section>
            ) : null}

            {activeSection === "library" ? (
              <section className="flex max-w-[440px] flex-col gap-5">
                <h2 className="text-sm font-bold text-text-primary">Biblioteca</h2>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-text-primary">Local de armazenamento</span>
                  <span className="truncate text-xs text-text-secondary" title={storagePath}>
                    {storagePath || "Carregando..."}
                  </span>
                </div>
              </section>
            ) : null}

            {activeSection === "advanced" ? <EmptySettingsSection title="Avançado" /> : null}
          </div>
        </div>
      )}
    </FloatingPanelFrame>
  );
}

function EmptySettingsSection({ title }: { title: string }) {
  return (
    <section className="flex max-w-[440px] flex-col gap-4">
      <h2 className="text-sm font-bold text-text-primary">{title}</h2>
      <span className="text-sm text-text-secondary">Sem ajustes por enquanto.</span>
    </section>
  );
}

function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4">
      <span className="text-sm font-semibold text-text-primary">{label}</span>
      {children}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={`relative h-7 w-12 rounded-full border border-border-subtle transition ${
        checked ? "bg-primary" : "bg-surface-muted"
      }`}
    >
      <span
        className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition ${
          checked ? "left-[22px]" : "left-1"
        }`}
      />
    </button>
  );
}

function IconVariantCard({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={label}
      className={`flex h-[120px] w-[120px] flex-col items-center justify-center gap-2 rounded-xl bg-surface-card shadow-card transition ${
        selected ? "border-2 border-primary" : "border border-[#E8DDD4] hover:border-primary dark:border-border-subtle"
      }`}
    >
      {children}
      <span className="text-xs font-medium text-text-secondary">{label}</span>
    </button>
  );
}
