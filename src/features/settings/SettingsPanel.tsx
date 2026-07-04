import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { appDataDir } from "@tauri-apps/api/path";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import { SectionLabel } from "../../components/ui/SectionLabel";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useTheme, type Theme } from "../../hooks/useTheme";
import { getSetting, setSetting } from "../../lib/database";
// SVG real da variante "Coluna" (origem: redesign/reference-prints/icons/
// ColumnIcon.svg, copiado para ca fora do fluxo normal de design). Importado
// como URL pelo Vite; renderizado via CSS mask para herdar currentColor — o
// arquivo tem fill branco fixo, que sumiria num card claro.
import columnIconUrl from "../../assets/icons/column-icon.svg";

// Dimensoes do painel. O conteudo interno e limitado a ~480px centralizado
// (so 3 controles em lista), entao o painel nao precisa ser largo. Exportadas
// para o LibraryView abrir o painel centralizado.
export const settingsPanelWidth = 560;
export const settingsPanelHeight = 560;
const settingsPanelMinWidth = 420;
const settingsPanelMinHeight = 360;
const collapsedHeight = 48;

// icon_variant persistido em app_settings (migration v14). So a "coluna" tem
// SVG real por enquanto; "frontao" fica em placeholder ate o arquivo existir.
type IconVariant = "frontao" | "coluna";
const iconVariantSettingKey = "icon_variant";
const defaultIconVariant: IconVariant = "coluna";

function getMaximizedPanelSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

// Icones locais do chrome do painel (mesmo padrao dos outros paineis, que
// definem os seus). 16px, stroke currentColor.
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

type SettingsPanelProps = {
  panel: FloatingPanel;
  onClose: () => void;
};

export function SettingsPanel({ panel, onClose }: SettingsPanelProps) {
  const { movePanel } = useFloatingPanels();
  const { theme, setTheme } = useTheme();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: settingsPanelWidth, height: settingsPanelHeight });
  // Guarda posicao/tamanho de antes de maximizar, para o restaurar voltar ao
  // lugar exato (mesmo padrao do NotebookPanel).
  const restoreStateRef = useRef<{ position: { x: number; y: number }; size: { width: number; height: number }; collapsed: boolean } | null>(null);

  const [iconVariant, setIconVariant] = useState<IconVariant>(defaultIconVariant);
  const [storagePath, setStoragePath] = useState("");

  // Carrega a variante de icone salva e o caminho de armazenamento atual. O
  // caminho e o app_data_dir resolvido pelo Tauri (read-only por ora: nao ha
  // conceito de biblioteca movivel ainda).
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [storedVariant, dir] = await Promise.all([
        getSetting(iconVariantSettingKey).catch(() => null),
        appDataDir().catch(() => ""),
      ]);

      if (cancelled) {
        return;
      }

      if (storedVariant === "frontao" || storedVariant === "coluna") {
        setIconVariant(storedVariant);
      }
      setStoragePath(dir);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const chooseIconVariant = useCallback((variant: IconVariant) => {
    setIconVariant(variant);
    // Persiste em background; a UI ja refletiu a escolha (otimista). Aplicar a
    // variante ao icone REAL da janela/taskbar e um passo separado, ainda nao
    // pedido — aqui so guardamos a preferencia.
    void setSetting(iconVariantSettingKey, variant);
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

  // Mantem o painel maximizado colado na janela quando ela e redimensionada.
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
        // Header seguindo o tema (tokens --floating-header-*), nao fixo escuro.
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
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--card)]">
          <div className="mx-auto w-full max-w-[480px] px-6 py-8">
            {/* ================= SECAO 1: APARENCIA ================= */}
            <section className="flex flex-col gap-6">
              <SectionLabel>Aparência</SectionLabel>

              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-text-primary">Tema</span>
                <SegmentedControl<Theme>
                  ariaLabel="Tema"
                  options={themeOptions}
                  value={theme}
                  onChange={setTheme}
                />
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-sm font-medium text-text-primary">Ícone do app</span>
                <div className="flex gap-4">
                  <IconVariantCard
                    label="Frontão"
                    selected={iconVariant === "frontao"}
                    onSelect={() => chooseIconVariant("frontao")}
                  >
                    {/* Placeholder: o SVG do Frontao ainda nao existe no projeto. */}
                    <span className="text-xs font-medium text-text-subtle">Frontão</span>
                  </IconVariantCard>

                  <IconVariantCard
                    label="Coluna"
                    selected={iconVariant === "coluna"}
                    onSelect={() => chooseIconVariant("coluna")}
                  >
                    {/* SVG real via mask para herdar a cor do tema (o fill do
                        arquivo e branco fixo). */}
                    <span
                      aria-hidden
                      className="h-10 w-10 bg-text-primary"
                      style={{
                        maskImage: `url(${columnIconUrl})`,
                        WebkitMaskImage: `url(${columnIconUrl})`,
                        maskSize: "contain",
                        WebkitMaskSize: "contain",
                        maskRepeat: "no-repeat",
                        WebkitMaskRepeat: "no-repeat",
                        maskPosition: "center",
                        WebkitMaskPosition: "center",
                      }}
                    />
                  </IconVariantCard>
                </div>
              </div>
            </section>

            {/* ================= SECAO 2: BIBLIOTECA ================= */}
            <section className="mt-8 flex flex-col gap-4 border-t border-border-subtle pt-8">
              <SectionLabel>Biblioteca</SectionLabel>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-primary">Local de armazenamento</span>
                <span className="truncate text-xs text-text-secondary" title={storagePath}>
                  {storagePath || "Carregando…"}
                </span>
              </div>
            </section>
          </div>
        </div>
      )}
    </FloatingPanelFrame>
  );
}

// Card de escolha da variante de icone (~120x120). Reaproveita os mesmos
// tokens dos cards de Caderno/Quadro (surface/border/radius/shadow); o anel
// terracota de 2px marca o selecionado.
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
    </button>
  );
}
