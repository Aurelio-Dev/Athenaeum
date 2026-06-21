import { useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";

type PdfTextLayer = pdfjsLib.TextLayer;
type PdfDocument = pdfjsLib.PDFDocumentProxy;

type PdfTextLayerProps = {
  pdfDocument: PdfDocument;
  pageNumber: number;
  // Mesma escala usada para renderizar o canvas da pagina, para o texto
  // transparente cair exatamente sobre as letras desenhadas.
  scale: number;
};

// Renderiza a camada de texto selecionavel do pdf.js sobre o canvas. Os spans
// sao transparentes (CSS de .textLayer): servem so para o navegador permitir
// selecao nativa, que depois viramos highlight ancorado.
export function PdfTextLayer({ pdfDocument, pageNumber, scale }: PdfTextLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let isCancelled = false;
    let textLayer: PdfTextLayer | null = null;

    async function renderTextLayer() {
      const page = await pdfDocument.getPage(pageNumber);
      if (isCancelled || !container) {
        return;
      }

      const viewport = page.getViewport({ scale });
      // Algumas regras do pdf_viewer.css usam --scale-factor; mantemos em dia.
      container.style.setProperty("--scale-factor", String(scale));
      container.replaceChildren();

      textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      });

      await textLayer.render();
    }

    renderTextLayer().catch((error) => {
      // Cancelamento ao trocar de pagina/zoom e esperado; nao e erro real.
      if (!isCancelled && error?.name !== "AbortException") {
        console.warn("Falha ao renderizar a camada de texto.", error);
      }
    });

    return () => {
      isCancelled = true;
      textLayer?.cancel();
    };
  }, [pdfDocument, pageNumber, scale]);

  // A classe .textLayer vem do CSS oficial do pdf.js (importado no ReaderModal).
  return <div ref={containerRef} className="textLayer" />;
}
