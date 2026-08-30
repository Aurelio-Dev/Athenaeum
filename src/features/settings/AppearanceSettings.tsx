import { useEffect, useRef, useState } from "react";
import { InfoDialog } from "../../components/InfoDialog";
import { useDividerLines } from "../../hooks/useDividerLines";
import {
  uiFontScaleOptions,
  useAppearancePreferences,
  type UiFontScale,
} from "../../hooks/useAppearancePreferences";
import { useGlobalAppearancePreferences } from "../../hooks/useGlobalAppearancePreferences";
import { useTheme, type Theme } from "../../hooks/useTheme";
import { useWallpaperSettings } from "../../hooks/useWallpaperSettings";
import {
  DEFAULT_WALLPAPER_BRIGHTNESS,
  DEFAULT_WALLPAPER_OPACITY,
  MAX_WALLPAPER_BRIGHTNESS,
  MAX_WALLPAPER_OPACITY,
  MIN_WALLPAPER_BRIGHTNESS,
  MIN_WALLPAPER_OPACITY,
  deleteSetting,
  getGlassNoticeSeen,
  setGlassNoticeSeen,
  type ChromeVariant,
  type MaterialVariant,
} from "../../lib/database";
import {
  DEFAULT_APPEARANCE_CONTRAST,
  MAX_APPEARANCE_CONTRAST,
  MAX_GLASS_BLUR,
  MAX_NIGHT_LIGHT_STRENGTH,
  MIN_APPEARANCE_CONTRAST,
  MIN_GLASS_BLUR,
  MIN_NIGHT_LIGHT_STRENGTH,
  isHexColor,
  type AppearanceAccentTheme,
  type HexColor,
  type NightLightPreferences,
} from "../../lib/appearancePreferences";

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

function ToggleSwitch({
  checked,
  disabled = false,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`relative h-7 w-12 rounded-full border border-border-subtle transition disabled:cursor-not-allowed disabled:opacity-40 ${checked ? "bg-primary" : "bg-surface-muted"}`}
    >
      <span className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full shadow-sm transition ${checked ? "left-[22px] bg-primary-foreground" : "left-1 bg-white"}`} />
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
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-surface-panel text-base text-text-secondary transition hover:border-primary hover:text-primary-text disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Diminuir ${ariaLabel.toLowerCase()}`}
      >
        −
      </button>
      <span className="w-12 text-center text-xs font-semibold tabular-nums text-text-primary">{value}%</span>
      <button
        type="button"
        onClick={() => canIncrease && onChange(options[currentIndex + 1])}
        disabled={!canIncrease}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-surface-panel text-base text-text-secondary transition hover:border-primary hover:text-primary-text disabled:cursor-not-allowed disabled:opacity-40"
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
                ? "bg-primary text-primary-foreground"
                : "text-text-secondary hover:text-primary-text"
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
                ? "bg-primary text-primary-foreground"
                : "text-text-secondary hover:text-primary-text"
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
  "h-8 rounded-lg border border-border-subtle bg-surface-panel px-3 text-xs font-semibold text-text-secondary transition hover:border-primary hover:text-primary-text disabled:cursor-not-allowed disabled:opacity-40";

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
  brightness,
  isLoading,
  isImporting,
  error,
  onChoose,
  onRemove,
}: {
  previewUrl: string | null;
  brightness: number;
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
              style={{ filter: `brightness(${brightness / 100})` }}
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

function AppearanceRangeControl({
  value,
  min,
  max,
  disabled = false,
  ariaLabel,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  // `draft` nao nulo significa "editando": guarda o texto cru para o campo
  // aceitar apagar tudo e redigitar sem que o valor aplicado oscile no meio.
  const [draft, setDraft] = useState<string | null>(null);

  function startEditing() {
    if (!disabled) {
      setDraft(String(value));
    }
  }

  function commitDraft() {
    if (draft === null) {
      return;
    }

    const texto = draft.trim();
    setDraft(null);
    if (texto.length === 0) {
      return;
    }

    const digitado = Number(texto);
    if (!Number.isFinite(digitado)) {
      return;
    }

    const dentroDaFaixa = Math.min(max, Math.max(min, Math.round(digitado)));
    if (dentroDaFaixa !== value) {
      onChange(dentroDaFaixa);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={`${value}%`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-40 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
      />
      {draft === null ? (
        // Botao, e nao span: o duplo clique sozinho seria invisivel para
        // teclado e leitor de tela. O clique simples e deliberadamente inerte
        // para nao abrir o campo quando o ponteiro so passa perto do slider.
        <button
          type="button"
          disabled={disabled}
          title="Duplo clique para digitar o valor"
          aria-label={`${ariaLabel}: ${value}%. Duplo clique ou Enter para digitar o valor.`}
          onDoubleClick={startEditing}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              startEditing();
            }
          }}
          className="w-12 rounded text-right text-xs font-semibold tabular-nums text-text-primary outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {value}%
        </button>
      ) : (
        <span className="flex w-12 items-center justify-end gap-0.5">
          {/* type="text" + inputMode numerico: o spinner do type="number" nao
              cabe nesta largura e duplicaria o que o slider ao lado ja faz. */}
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={draft}
            maxLength={3}
            aria-label={`${ariaLabel} em porcentagem, de ${min} a ${max}`}
            onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ""))}
            onFocus={(event) => event.target.select()}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(null);
              }
            }}
            className="w-8 rounded bg-transparent text-right text-xs font-semibold tabular-nums text-text-primary outline-none ring-1 ring-primary"
          />
          <span aria-hidden="true" className="text-xs font-semibold text-text-primary">%</span>
        </span>
      )}
    </div>
  );
}

// A regiao viva existe sempre, mesmo vazia: um role="status" inserido junto com
// o texto costuma nao ser anunciado. "status" e educado de proposito — o aviso
// acompanha um slider e nao pode interromper o arraste como um alert faria. A
// cor permanece neutra porque o aviso nao pode depender de cor para existir.
function ContrastLegibilityNotice({ visible, message }: { visible: boolean; message: string }) {
  return (
    <p role="status" className="max-w-[260px] text-right text-xs leading-4 text-text-secondary">
      {visible ? message : ""}
    </p>
  );
}

// "Ativa agora" cobre o modo continuo e a agenda em curso. Fora da janela
// agendada a proxima ativacao e o proprio horario de inicio, porque a agenda se
// repete todos os dias.
function nightLightDescription(nightLight: NightLightPreferences, active: boolean): string {
  if (active) {
    return "A luz noturna está ativa agora.";
  }

  if (nightLight.enabled && nightLight.scheduleEnabled) {
    return `A luz noturna ativa automaticamente às ${nightLight.startTime}.`;
  }

  return "Reduza a luz azul com uma camada de tonalidade quente.";
}

export function AppearanceSettings() {
  const { theme, setTheme, material, setMaterial, storedChrome, setChrome } = useTheme();
  const { showDividerLines, setShowDividerLines } = useDividerLines();
  const { uiFontScale, setUiFontScale } = useAppearancePreferences();
  const {
    preferences,
    setAccent,
    setInterfaceContrast,
    setTextContrast,
    setTitleContrast,
    setGlassBlur,
    setNightLight,
    resetAppearancePreferences,
    nightLightActive,
  } = useGlobalAppearancePreferences();
  const wallpaper = useWallpaperSettings();
  const [hasSeenGlassNotice, setHasSeenGlassNotice] = useState<boolean | null>(null);
  const [isGlassNoticeOpen, setIsGlassNoticeOpen] = useState(false);
  const shouldShowGlassNoticeAfterLoadRef = useRef(false);
  const glassNoticeReadVersionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const readVersion = ++glassNoticeReadVersionRef.current;

    void (async () => {
      let seen = false;
      try {
        seen = await getGlassNoticeSeen();
      } catch {
        // Sem leitura confiavel, tratamos como primeira abertura para nao
        // esconder permanentemente um aviso que o usuario ainda nao viu.
      }

      if (cancelled || readVersion !== glassNoticeReadVersionRef.current) {
        return;
      }

      setHasSeenGlassNotice(seen);
      if (!seen && shouldShowGlassNoticeAfterLoadRef.current) {
        shouldShowGlassNoticeAfterLoadRef.current = false;
        setIsGlassNoticeOpen(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleMaterialChange(nextMaterial: MaterialVariant) {
    if (nextMaterial === material) {
      return;
    }

    setMaterial(nextMaterial);

    if (nextMaterial !== "glass") {
      shouldShowGlassNoticeAfterLoadRef.current = false;
      return;
    }

    if (hasSeenGlassNotice === true) {
      return;
    }

    if (hasSeenGlassNotice === false) {
      setIsGlassNoticeOpen(true);
      return;
    }

    shouldShowGlassNoticeAfterLoadRef.current = true;
  }

  function dismissGlassNotice() {
    shouldShowGlassNoticeAfterLoadRef.current = false;
    setIsGlassNoticeOpen(false);
    setHasSeenGlassNotice(true);
    void setGlassNoticeSeen();
  }

  function restoreDefaults() {
    setTheme("light");
    setMaterial("flat");
    setChrome(null);
    glassNoticeReadVersionRef.current += 1;
    shouldShowGlassNoticeAfterLoadRef.current = false;
    setHasSeenGlassNotice(false);
    setIsGlassNoticeOpen(false);
    void deleteSetting("glass_notice_seen");
    setShowDividerLines(true);
    setUiFontScale(100);
    resetAppearancePreferences();
    // A opacidade volta ao padrao, mas a IMAGEM nao e removida: restaurar
    // padroes de aparencia nao pode apagar do disco um arquivo que o usuario
    // importou. Para isso existe o botao Remover, que diz o que faz.
    wallpaper.changeOpacity(DEFAULT_WALLPAPER_OPACITY);
    wallpaper.changeBrightness(DEFAULT_WALLPAPER_BRIGHTNESS);
  }

  return (
    <section className="flex max-w-[720px] flex-col gap-4">
      <header>
        <h2 className="app-title font-serif text-xl font-medium">Aparência</h2>
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
          label="Destaque"
          description="Escolha a cor das ações e seleções da interface em cada tema."
        >
          <div className="flex min-w-64 flex-col gap-2">
            <AccentColorControl theme="light" value={preferences.accentLight} onChange={setAccent} />
            <AccentColorControl theme="dark" value={preferences.accentDark} onChange={setAccent} />
          </div>
        </SettingRow>

        <SettingRow
          label="Material"
          description="Escolha o acabamento das superfícies. Funciona nos temas claro e escuro. O material Vidro prioriza a estética sobre a legibilidade e não segue os pisos de contraste do material Padrão."
        >
          <MaterialControl material={material} onChange={handleMaterialChange} />
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
            brightness={wallpaper.brightness}
            isLoading={wallpaper.isLoading}
            isImporting={wallpaper.isImporting}
            error={wallpaper.error}
            onChoose={() => void wallpaper.chooseWallpaper()}
            onRemove={() => void wallpaper.removeWallpaper()}
          />
        </SettingRow>

        <SettingRow
          label="Visibilidade do papel de parede"
          description="Defina o quanto a imagem aparece por trás da interface."
        >
          <AppearanceRangeControl
            value={wallpaper.opacity}
            min={MIN_WALLPAPER_OPACITY}
            max={MAX_WALLPAPER_OPACITY}
            disabled={wallpaper.fileName === null}
            ariaLabel="Visibilidade do papel de parede"
            onChange={wallpaper.changeOpacity}
          />
        </SettingRow>

        <SettingRow
          label="Brilho do papel de parede"
          description="Ajuste a luminosidade da imagem sem alterar a interface."
        >
          <AppearanceRangeControl
            value={wallpaper.brightness}
            min={MIN_WALLPAPER_BRIGHTNESS}
            max={MAX_WALLPAPER_BRIGHTNESS}
            disabled={wallpaper.fileName === null}
            ariaLabel="Brilho do papel de parede"
            onChange={wallpaper.changeBrightness}
          />
        </SettingRow>

        <SettingRow
          label="Desfoque do material Vidro"
          description={`Ajuste o desfoque nas superfícies LiquidGlass. Perto de 0%, elas ficam mais transparentes.${
            material === "flat" ? " Selecione o material Vidro para visualizar." : ""
          }`}
        >
          <AppearanceRangeControl
            value={preferences.glassBlur}
            min={MIN_GLASS_BLUR}
            max={MAX_GLASS_BLUR}
            disabled={material === "flat"}
            ariaLabel="Desfoque do material Vidro"
            onChange={setGlassBlur}
          />
        </SettingRow>

        <SettingRow label="Linhas divisórias" description="Exibir linhas sutis entre seções e itens.">
          <ToggleSwitch
            checked={showDividerLines}
            onCheckedChange={setShowDividerLines}
            ariaLabel={showDividerLines ? "Ocultar linhas divisórias" : "Mostrar linhas divisórias"}
          />
        </SettingRow>

        <SettingRow label="Contraste da interface" description="Ajuste a separação entre superfícies, controles e bordas.">
          <div className="flex flex-col items-end gap-1.5">
            <AppearanceRangeControl
              value={preferences.interfaceContrast}
              min={MIN_APPEARANCE_CONTRAST}
              max={MAX_APPEARANCE_CONTRAST}
              ariaLabel="Contraste da interface"
              onChange={setInterfaceContrast}
            />
            <ContrastLegibilityNotice
              visible={preferences.interfaceContrast < DEFAULT_APPEARANCE_CONTRAST}
              message="Abaixo de 100%, bordas e superfícies ficam menos separadas."
            />
          </div>
        </SettingRow>

        <SettingRow label="Contraste dos textos" description="Ajuste a diferença entre os textos e as superfícies da interface.">
          <div className="flex flex-col items-end gap-1.5">
            <AppearanceRangeControl
              value={preferences.textContrast}
              min={MIN_APPEARANCE_CONTRAST}
              max={MAX_APPEARANCE_CONTRAST}
              ariaLabel="Contraste dos textos"
              onChange={setTextContrast}
            />
            <ContrastLegibilityNotice
              visible={preferences.textContrast < DEFAULT_APPEARANCE_CONTRAST}
              message="Abaixo de 100%, os textos da interface ficam menos legíveis."
            />
          </div>
        </SettingRow>

        <SettingRow
          label="Contraste dos títulos"
          description="Ajuste a legibilidade dos títulos de página e de seção, como o nome da coleção."
        >
          <div className="flex flex-col items-end gap-1.5">
            <AppearanceRangeControl
              value={preferences.titleContrast}
              min={MIN_APPEARANCE_CONTRAST}
              max={MAX_APPEARANCE_CONTRAST}
              ariaLabel="Contraste dos títulos"
              onChange={setTitleContrast}
            />
            <ContrastLegibilityNotice
              visible={preferences.titleContrast < DEFAULT_APPEARANCE_CONTRAST}
              message="Abaixo de 100%, os títulos ficam menos legíveis."
            />
          </div>
        </SettingRow>

        <SettingRow
          label="Luz azul"
          description={nightLightDescription(preferences.nightLight, nightLightActive)}
        >
          <ToggleSwitch
            checked={preferences.nightLight.enabled}
            onCheckedChange={(enabled) => setNightLight({ ...preferences.nightLight, enabled })}
            ariaLabel={preferences.nightLight.enabled ? "Desativar luz noturna" : "Ativar luz noturna"}
          />
        </SettingRow>

        <SettingRow label="Força da luz noturna" description="Ajuste a intensidade da tonalidade quente.">
          <AppearanceRangeControl
            value={preferences.nightLight.strength}
            min={MIN_NIGHT_LIGHT_STRENGTH}
            max={MAX_NIGHT_LIGHT_STRENGTH}
            disabled={!preferences.nightLight.enabled}
            ariaLabel="Força da luz noturna"
            onChange={(strength) => setNightLight({ ...preferences.nightLight, strength })}
          />
        </SettingRow>

        <SettingRow label="Agendar luz noturna" description="Ative a tonalidade automaticamente todos os dias.">
          <ToggleSwitch
            checked={preferences.nightLight.scheduleEnabled}
            disabled={!preferences.nightLight.enabled}
            onCheckedChange={(scheduleEnabled) => setNightLight({ ...preferences.nightLight, scheduleEnabled })}
            ariaLabel={preferences.nightLight.scheduleEnabled ? "Desativar agendamento da luz noturna" : "Ativar agendamento da luz noturna"}
          />
        </SettingRow>

        {/* Os horarios so aparecem com a agenda habilitada. Ocultar a linha nao
            descarta nada: os valores continuam no snapshot e voltam intactos
            quando a agenda for reativada. */}
        {preferences.nightLight.enabled && preferences.nightLight.scheduleEnabled ? (
          <SettingRow
            label="Horário da luz noturna"
            description="Defina o início e o fim. Horários iguais mantêm a luz ativa por 24 horas."
          >
            <NightLightScheduleControl
              startTime={preferences.nightLight.startTime}
              endTime={preferences.nightLight.endTime}
              onStartTimeChange={(startTime) => setNightLight({ ...preferences.nightLight, startTime })}
              onEndTimeChange={(endTime) => setNightLight({ ...preferences.nightLight, endTime })}
            />
          </SettingRow>
        ) : null}

        <SettingRow label="Tamanho da fonte da UI" description="Aumente ou diminua os textos e controles da interface.">
          <StepControl<UiFontScale> value={uiFontScale} options={uiFontScaleOptions} onChange={setUiFontScale} ariaLabel="Tamanho da fonte da UI" />
        </SettingRow>
      </div>

      <button
        type="button"
        onClick={restoreDefaults}
        className="self-start rounded-lg border border-border-subtle bg-surface-panel px-3 py-2 text-xs font-semibold text-text-secondary transition hover:border-primary hover:text-primary-text"
      >
        Restaurar padrões
      </button>

      {isGlassNoticeOpen ? (
        <InfoDialog
          title="Sobre o material Vidro"
          message="O material Vidro prioriza a estética sobre a legibilidade e não segue os pisos de contraste do material Padrão. Se preferir contraste máximo, o material Padrão continua disponível a qualquer momento."
          onDismiss={dismissGlassNotice}
        />
      ) : null}
    </section>
  );
}

function AccentColorControl({
  theme,
  value,
  onChange,
}: {
  theme: AppearanceAccentTheme;
  value: HexColor;
  onChange: (theme: AppearanceAccentTheme, color: HexColor) => void;
}) {
  const themeLabel = theme === "light" ? "Tema claro" : "Tema escuro";
  const [draft, setDraft] = useState<string>(value);

  // O campo aceita digitacao parcial, mas so promove um #RRGGBB completo.
  // Quando a cor chega do seletor nativo, de outra janela ou de "Restaurar
  // padroes", o rascunho volta a segui-la.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  function handleHexInput(next: string) {
    const candidate = (next.startsWith("#") ? next : `#${next}`).toUpperCase();
    setDraft(candidate);
    if (isHexColor(candidate)) {
      onChange(theme, candidate);
    }
  }

  // O wrapper e um div, e nao um label: com dois controles dentro, o label
  // nativo associaria o texto do tema apenas ao primeiro deles. Cada input
  // carrega o proprio aria-label.
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-text-secondary">{themeLabel}</span>
      <span className="flex h-9 min-w-44 items-center gap-2 rounded-lg border border-border-subtle bg-surface-panel px-2.5">
        <input
          type="color"
          value={value}
          aria-label={`Cor de destaque do ${themeLabel.toLowerCase()}`}
          onChange={(event) => onChange(theme, event.target.value.toUpperCase() as HexColor)}
          className="h-5 w-5 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={draft}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-label={`Hexadecimal do destaque do ${themeLabel.toLowerCase()}`}
          onChange={(event) => handleHexInput(event.target.value)}
          onBlur={() => setDraft(value)}
          className="w-[76px] bg-transparent text-xs font-semibold uppercase tabular-nums text-text-primary outline-none"
        />
      </span>
    </div>
  );
}

function NightLightScheduleControl({
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
}: {
  startTime: string;
  endTime: string;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
}) {
  const inputClassName =
    "h-9 rounded-lg border border-border-subtle bg-surface-panel px-2 text-xs font-semibold text-text-primary outline-none transition focus:border-primary";

  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={startTime}
        aria-label="Início da luz noturna"
        onChange={(event) => onStartTimeChange(event.target.value)}
        className={inputClassName}
      />
      <span className="text-xs text-text-secondary">até</span>
      <input
        type="time"
        value={endTime}
        aria-label="Fim da luz noturna"
        onChange={(event) => onEndTimeChange(event.target.value)}
        className={inputClassName}
      />
    </div>
  );
}
