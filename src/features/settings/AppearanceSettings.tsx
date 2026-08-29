import { useDividerLines } from "../../hooks/useDividerLines";
import {
  uiContrastOptions,
  uiFontScaleOptions,
  useAppearancePreferences,
  type UiContrast,
  type UiFontScale,
} from "../../hooks/useAppearancePreferences";
import { useTheme, type Theme } from "../../hooks/useTheme";
import { useWallpaperSettings } from "../../hooks/useWallpaperSettings";
import {
  DEFAULT_WALLPAPER_OPACITY,
  MAX_WALLPAPER_OPACITY,
  MIN_WALLPAPER_OPACITY,
  type ChromeVariant,
  type MaterialVariant,
} from "../../lib/database";

type SettingRowProps = {
  label: string;
  description: string;
  children: React.ReactNode;
};

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex min-h-[72px] items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
        <p className="mt-0.5 text-xs leading-5 text-text-secondary">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleSwitch({ checked, onCheckedChange, ariaLabel }: { checked: boolean; onCheckedChange: (checked: boolean) => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={`relative h-7 w-12 rounded-full border border-border-subtle transition ${checked ? "bg-primary" : "bg-surface-muted"}`}
    >
      <span className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition ${checked ? "left-[22px]" : "left-1"}`} />
    </button>
  );
}

function StepControl<T extends number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const currentIndex = options.indexOf(value);
  const canDecrease = currentIndex > 0;
  const canIncrease = currentIndex >= 0 && currentIndex < options.length - 1;

  return (
    <div className="flex items-center gap-2" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={() => canDecrease && onChange(options[currentIndex - 1])}
        disabled={!canDecrease}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-surface-panel text-base text-text-secondary transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Diminuir ${ariaLabel.toLowerCase()}`}
      >
        −
      </button>
      <span className="w-12 text-center text-xs font-semibold tabular-nums text-text-primary">{value}%</span>
      <button
        type="button"
        onClick={() => canIncrease && onChange(options[currentIndex + 1])}
        disabled={!canIncrease}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-surface-panel text-base text-text-secondary transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Aumentar ${ariaLabel.toLowerCase()}`}
      >
        +
      </button>
    </div>
  );
}

const materialOptions: ReadonlyArray<{ value: MaterialVariant; label: string }> = [
  { value: "flat", label: "Padrão" },
  { value: "glass", label: "Vidro" },
];

// Controle do eixo de MATERIAL, separado do controle de modo acima: os dois sao
// ortogonais (claro/vidro e escuro/vidro existem), nao uma lista de tres temas.
//
// SEM PREVIEW, de proposito: o material so muda no clique confirmado. O efeito
// que aplica data-material no <html> tambem grava o espelho em localStorage
// (ver useTheme.tsx), entao aplicar em hover, foco ou navegacao por setas
// vazaria para o cache e deixaria o usuario com um material que nao escolheu —
// inclusive na proxima abertura do app. Por isso aqui so existe onClick: nada
// de onMouseEnter, onFocus ou roving tabindex.
function MaterialControl({
  material,
  onChange,
}: {
  material: MaterialVariant;
  onChange: (material: MaterialVariant) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Material da interface"
      className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-panel p-1"
    >
      {materialOptions.map((option) => {
        const isSelected = option.value === material;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-md px-3 text-xs font-semibold transition ${
              isSelected
                ? "bg-primary text-text-inverse"
                : "text-text-secondary hover:text-primary"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const layoutOptions: ReadonlyArray<{ value: ChromeVariant | null; label: string }> = [
  { value: null, label: "Automático" },
  { value: "docked", label: "Docado" },
  { value: "floating", label: "Ilhas" },
];

function LayoutControl({
  storedChrome,
  disabled,
  onChange,
}: {
  storedChrome: ChromeVariant | null;
  disabled: boolean;
  onChange: (chrome: ChromeVariant | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Layout da interface"
      className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-panel p-1"
    >
      {layoutOptions.map((option) => {
        const isSelected = option.value === storedChrome;

        return (
          <button
            key={option.value ?? "automatico"}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-md px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              isSelected
                ? "bg-primary text-text-inverse"
                : "text-text-secondary hover:text-primary"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const secondaryButtonClassName =
  "h-8 rounded-lg border border-border-subtle bg-surface-panel px-3 text-xs font-semibold text-text-secondary transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";

// Controle do papel de parede: escolher, ver o que esta escolhido e remover.
//
// SEM PREVIEW ao passar o mouse ou receber foco, pela mesma razao do controle
// de material acima: escolher uma imagem nao e so pintar a tela — copia um
// arquivo para o diretorio de dados e apaga o anterior. Aplicar isso em hover
// deixaria o usuario com um wallpaper que ele nao escolheu, e com o anterior
// ja apagado do disco. Por isso so existe onClick aqui: nada de onMouseEnter,
// onFocus ou navegacao por setas.
function WallpaperControl({
  previewUrl,
  isLoading,
  isImporting,
  error,
  onChoose,
  onRemove,
}: {
  previewUrl: string | null;
  isLoading: boolean;
  isImporting: boolean;
  error: string | null;
  onChoose: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-muted"
          aria-hidden={previewUrl ? undefined : true}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Prévia do papel de parede"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
              Nenhuma
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onChoose}
          disabled={isLoading || isImporting}
          className={secondaryButtonClassName}
        >
          {isImporting ? "Copiando..." : previewUrl ? "Trocar imagem" : "Escolher imagem"}
        </button>

        {previewUrl ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={isImporting}
            className={secondaryButtonClassName}
          >
            Remover
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="max-w-[280px] text-right text-xs leading-4 text-status-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function WallpaperOpacityControl({
  opacity,
  disabled,
  onChange,
}: {
  opacity: number;
  disabled: boolean;
  onChange: (opacity: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={MIN_WALLPAPER_OPACITY}
        max={MAX_WALLPAPER_OPACITY}
        step={1}
        value={opacity}
        disabled={disabled}
        aria-label="Opacidade do papel de parede"
        aria-valuetext={`${opacity}%`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-40 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
      />
      <span className="w-10 text-right text-xs font-semibold tabular-nums text-text-primary">
        {opacity}%
      </span>
    </div>
  );
}

export function AppearanceSettings() {
  const { theme, setTheme, material, setMaterial, storedChrome, setChrome } = useTheme();
  const { showDividerLines, setShowDividerLines } = useDividerLines();
  const { uiContrast, setUiContrast, uiFontScale, setUiFontScale } = useAppearancePreferences();
  const wallpaper = useWallpaperSettings();

  function restoreDefaults() {
    setTheme("light");
    setMaterial("flat");
    setChrome(null);
    setShowDividerLines(true);
    setUiContrast(100);
    setUiFontScale(100);
    // A opacidade volta ao padrao, mas a IMAGEM nao e removida: restaurar
    // padroes de aparencia nao pode apagar do disco um arquivo que o usuario
    // importou. Para isso existe o botao Remover, que diz o que faz.
    wallpaper.changeOpacity(DEFAULT_WALLPAPER_OPACITY);
  }

  return (
    <section className="flex max-w-[580px] flex-col gap-4">
      <header>
        <h2 className="font-serif text-xl font-medium text-text-primary">Aparência</h2>
        <p className="mt-1 text-xs leading-5 text-text-secondary">Personalize como o Athenaeum se apresenta para você.</p>
      </header>

      <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-card">
        <SettingRow label="Tema" description="Escolha o tema da interface.">
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value as Theme)}
            className="h-9 min-w-36 rounded-lg border border-border-subtle bg-surface-panel px-3 text-xs font-semibold text-text-primary outline-none transition focus:border-primary"
            aria-label="Tema da interface"
          >
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </select>
        </SettingRow>

        <SettingRow
          label="Material"
          description="Escolha o acabamento das superfícies. Funciona nos temas claro e escuro. O material Vidro prioriza a estética sobre a legibilidade e não segue os pisos de contraste do material Padrão."
        >
          <MaterialControl material={material} onChange={setMaterial} />
        </SettingRow>

        <SettingRow
          label="Layout"
          description={`Ilhas flutuantes deixam o papel de parede aparecer entre os painéis. Disponível apenas no material Vidro.${
            material === "flat" ? " Selecione o material Vidro para alterar." : ""
          }`}
        >
          <LayoutControl
            storedChrome={storedChrome}
            disabled={material === "flat"}
            onChange={setChrome}
          />
        </SettingRow>

        <SettingRow
          label="Papel de parede"
          description="Escolha uma imagem para o fundo do app. Ela aparece atrás das superfícies translúcidas do material Vidro."
        >
          <WallpaperControl
            previewUrl={wallpaper.previewUrl}
            isLoading={wallpaper.isLoading}
            isImporting={wallpaper.isImporting}
            error={wallpaper.error}
            onChoose={() => void wallpaper.chooseWallpaper()}
            onRemove={() => void wallpaper.removeWallpaper()}
          />
        </SettingRow>

        <SettingRow
          label="Opacidade do papel de parede"
          description="Defina o quanto a imagem aparece por trás da interface."
        >
          <WallpaperOpacityControl
            opacity={wallpaper.opacity}
            disabled={wallpaper.fileName === null}
            onChange={wallpaper.changeOpacity}
          />
        </SettingRow>

        <SettingRow label="Linhas divisórias" description="Exibir linhas sutis entre seções e itens.">
          <ToggleSwitch
            checked={showDividerLines}
            onCheckedChange={setShowDividerLines}
            ariaLabel={showDividerLines ? "Ocultar linhas divisórias" : "Mostrar linhas divisórias"}
          />
        </SettingRow>

        <SettingRow label="Contraste da interface" description="Ajuste a diferença entre textos, superfícies e bordas.">
          <StepControl<UiContrast> value={uiContrast} options={uiContrastOptions} onChange={setUiContrast} ariaLabel="Contraste da interface" />
        </SettingRow>

        <SettingRow label="Tamanho da fonte da UI" description="Aumente ou diminua os textos e controles da interface.">
          <StepControl<UiFontScale> value={uiFontScale} options={uiFontScaleOptions} onChange={setUiFontScale} ariaLabel="Tamanho da fonte da UI" />
        </SettingRow>
      </div>

      <button
        type="button"
        onClick={restoreDefaults}
        className="self-start rounded-lg border border-border-subtle bg-surface-panel px-3 py-2 text-xs font-semibold text-text-secondary transition hover:border-primary hover:text-primary"
      >
        Restaurar padrões
      </button>
    </section>
  );
}
