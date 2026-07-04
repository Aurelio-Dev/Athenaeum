import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SVGProps,
} from "react";
import { getSetting, setSetting } from "./database";

export type AppIconVariant = "frontao" | "coluna";

export const appIconVariantSettingKey = "icon_variant";
export const defaultAppIconVariant: AppIconVariant = "coluna";

const iconSize = 128;
const iconBackground = "#9C5A2E";
const iconForeground = "#FFFFFF";

const frontaoPaths = [
  "M1.5 7.5H14.5L8 2.5L1.5 7.5Z",
  "M14.5 7.5H1.5V9H14.5V7.5Z",
  "M4.5 9H1.5V12.5H4.5V9Z",
  "M9.5 9H6.5V12.5H9.5V9Z",
  "M14.5 9H11.5V12.5H14.5V9Z",
  "M14.5 12.5H1.5V13.5H14.5V12.5Z",
  "M15.25 13.5H0.75V14.25H15.25V13.5Z",
];

const colunaPaths = [
  "M12 2H4V3.5H12V2Z",
  "M4.5 3.5H11.5L11 4.5H5L4.5 3.5Z",
  "M6.5 4.5H5V11.5H6.5V4.5Z",
  "M8.75 4.5H7.25V11.5H8.75V4.5Z",
  "M11 4.5H9.5V11.5H11V4.5Z",
  "M11.5 11.5H4.5V12.25H11.5V11.5Z",
  "M12 12.25H4V13H12V12.25Z",
  "M12.5 13H3.5V14H12.5V13Z",
];

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

export function isAppIconVariant(value: string | null): value is AppIconVariant {
  return value === "frontao" || value === "coluna";
}

function getIconPaths(variant: AppIconVariant) {
  return variant === "frontao" ? frontaoPaths : colunaPaths;
}

function roundRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createIconRgba(variant: AppIconVariant) {
  const canvas = document.createElement("canvas");
  canvas.width = iconSize;
  canvas.height = iconSize;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Nao foi possivel criar o canvas do icone do app.");
  }

  context.clearRect(0, 0, iconSize, iconSize);
  context.fillStyle = iconBackground;
  roundRectPath(context, 12, 12, 104, 104, 22);
  context.fill();

  context.save();
  context.translate(36, variant === "frontao" ? 35 : 32);
  context.scale(3.5, 3.5);
  context.fillStyle = iconForeground;

  for (const path of getIconPaths(variant)) {
    context.fill(new Path2D(path));
  }

  context.restore();
  return new Uint8Array(context.getImageData(0, 0, iconSize, iconSize).data);
}

export async function applyAppIconVariant(variant: AppIconVariant) {
  if (!isTauriRuntime()) {
    return;
  }

  const [{ Image }, { getCurrentWindow }] = await Promise.all([
    import("@tauri-apps/api/image"),
    import("@tauri-apps/api/window"),
  ]);

  const icon = await Image.new(createIconRgba(variant), iconSize, iconSize);
  await getCurrentWindow().setIcon(icon);
}

export function AppIconGlyph({ variant, ...props }: SVGProps<SVGSVGElement> & { variant: AppIconVariant }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      {getIconPaths(variant).map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

export function AppIconPreview({ variant, className = "" }: { variant: AppIconVariant; className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-[14px] bg-primary text-text-inverse ${className}`}>
      <AppIconGlyph variant={variant} className="h-10 w-10" />
    </span>
  );
}

type AppIconContextValue = {
  variant: AppIconVariant;
  setVariant: (variant: AppIconVariant) => void;
};

const AppIconContext = createContext<AppIconContextValue | null>(null);

export function AppIconProvider({ children }: { children: ReactNode }) {
  const [variant, setVariantState] = useState<AppIconVariant>(defaultAppIconVariant);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const storedVariant = await getSetting(appIconVariantSettingKey).catch(() => null);
      if (cancelled) {
        return;
      }

      const nextVariant = isAppIconVariant(storedVariant) ? storedVariant : defaultAppIconVariant;
      setVariantState(nextVariant);
      await applyAppIconVariant(nextVariant);
    })().catch((error: unknown) => {
      console.error("Nao foi possivel aplicar o icone inicial do app.", error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setVariant = useCallback((nextVariant: AppIconVariant) => {
    setVariantState(nextVariant);
    void setSetting(appIconVariantSettingKey, nextVariant);
    void applyAppIconVariant(nextVariant).catch((error: unknown) => {
      console.error("Nao foi possivel aplicar o icone do app.", error);
    });
  }, []);

  const value = useMemo<AppIconContextValue>(() => ({ variant, setVariant }), [setVariant, variant]);

  return <AppIconContext.Provider value={value}>{children}</AppIconContext.Provider>;
}

export function useAppIcon() {
  const context = useContext(AppIconContext);

  if (!context) {
    throw new Error("useAppIcon deve ser usado dentro de AppIconProvider.");
  }

  return context;
}
