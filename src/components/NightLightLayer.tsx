import { createPortal } from "react-dom";

import { getNightLightOverlayOpacity } from "../lib/nightLight";

export const NIGHT_LIGHT_LAYER_CLASS_NAME = "night-light-layer";

type NightLightLayerProps = {
  active: boolean;
  strength: number;
};

export function NightLightLayer({ active, strength }: NightLightLayerProps) {
  const opacity = getNightLightOverlayOpacity(strength);

  if (!active || opacity <= 0) {
    return null;
  }

  return createPortal(
    <div
      className={NIGHT_LIGHT_LAYER_CLASS_NAME}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 11_000,
        pointerEvents: "none",
        backgroundColor: `rgba(255, 149, 46, ${opacity})`,
        mixBlendMode: "multiply",
      }}
    />,
    document.body,
  );
}
