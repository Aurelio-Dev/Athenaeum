import { useEffect, useRef } from "react";
import katex from "katex";

import { NotebookResizableFrame } from "./NotebookDiagramFrame";
import { applyEquationScale, parseEquationScale } from "./notebookDiagramScale";

type NotebookEquationPreviewProps = {
  source: string;
};

export function NotebookEquationPreview({ source }: NotebookEquationPreviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    try {
      katex.render(source, host, {
        displayMode: true,
        throwOnError: false,
        trust: false,
      });
    } catch (error) {
      console.warn("Nao foi possivel renderizar equacao com KaTeX.", error);
      host.textContent = source;
    }

    return () => {
      host.replaceChildren();
    };
  }, [source]);

  return (
    <NotebookResizableFrame
      blockSelector='[data-athenaeum-block="equation"]'
      scaleAttributeName="data-equation-scale"
      parseScale={parseEquationScale}
      applyScale={applyEquationScale}
      ariaLabel="Redimensionar equacao"
    >
      <div ref={hostRef} className="notebook-equation-render-host" />
    </NotebookResizableFrame>
  );
}
