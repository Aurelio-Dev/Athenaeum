import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

type DocumentPreviewProps = {
  documentId: string;
  filePath?: string;
  year: number;
};

type PdfPreviewResult = {
  dataUrl: string;
  pageCount: number;
};

function base64ToBytes(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

// Renderiza a primeira pagina do PDF como imagem (data URL) + total de paginas.
// O pdf.js e importado DINAMICAMENTE aqui dentro para nao entrar no bundle
// inicial — so carrega quando uma thumbnail e realmente gerada.
async function renderFirstPageThumbnail(filePath: string): Promise<PdfPreviewResult> {
  const [pdfjsLib, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.mjs?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;

  const base64 = await invoke<string>("read_pdf_file", { filePath });
  const loadingTask = pdfjsLib.getDocument({ data: base64ToBytes(base64) });

  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    // Renderiza com largura alvo fixa (x DPR ate 2) para uma imagem nitida mas
    // leve. A proporcao da pagina e preservada; o recorte visual fica por conta
    // do object-cover no <img>.
    const baseViewport = page.getViewport({ scale: 1 });
    const outputScale = Math.min(2, window.devicePixelRatio || 1);
    const targetWidth = 480;
    const viewport = page.getViewport({ scale: (targetWidth / baseViewport.width) * outputScale });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D indisponivel.");
    }

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;

    return { dataUrl: canvas.toDataURL("image/png"), pageCount: pdf.numPages };
  } finally {
    void loadingTask.destroy();
  }
}

// Esqueleto exibido enquanto a thumbnail carrega, quando nao ha arquivo, ou em
// caso de erro. Preenche o quadro (h-full) imitando o topo de uma pagina.
function PreviewSkeleton() {
  return (
    <div className="h-full w-full bg-surface-panel px-6 py-5">
      <div className="mx-auto h-2 w-2/5 rounded-full bg-primary" />
      <div className="mx-auto mt-2 h-1.5 w-1/2 rounded-full bg-indigo-200" />
      <div className="mt-4 rounded border border-indigo-200 bg-primary-soft p-3">
        <div className="h-1.5 w-1/4 rounded-full bg-indigo-300" />
        <div className="mt-2 space-y-1.5">
          <div className="h-1 w-full rounded-full bg-indigo-200" />
          <div className="h-1 w-11/12 rounded-full bg-indigo-200" />
          <div className="h-1 w-10/12 rounded-full bg-indigo-200" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <div className="h-1 w-full rounded-full bg-indigo-200" />
          <div className="h-1 w-10/12 rounded-full bg-indigo-200" />
          <div className="h-1 w-11/12 rounded-full bg-indigo-200" />
        </div>
        <div className="space-y-1.5">
          <div className="h-1 w-full rounded-full bg-indigo-200" />
          <div className="h-1 w-9/12 rounded-full bg-indigo-200" />
          <div className="h-1 w-7/12 rounded-full bg-indigo-200" />
        </div>
      </div>
    </div>
  );
}

// Pre-visualizacao do documento: thumbnail real da primeira pagina do PDF,
// cacheada por documento (react-query). A imagem preenche um quadro de proporcao
// fixa com object-cover/object-top, mostrando o topo da pagina sem vazar.
export function DocumentPreview({ documentId, filePath, year }: DocumentPreviewProps) {
  const { data } = useQuery<PdfPreviewResult>({
    queryKey: ["pdf-thumbnail", documentId],
    queryFn: () => renderFirstPageThumbnail(filePath as string),
    enabled: Boolean(filePath),
    staleTime: Infinity,
    retry: false,
  });

  return (
    <div className="rounded-lg border border-border-muted bg-surface-muted p-4">
      <div className="aspect-[16/10] w-full overflow-hidden rounded-md border border-indigo-200 bg-surface-panel shadow-card">
        {data ? (
          <img src={data.dataUrl} alt="Pre-visualizacao da primeira pagina" className="h-full w-full object-cover object-top" draggable={false} />
        ) : (
          <PreviewSkeleton />
        )}
      </div>
      <p className="mt-3 text-center text-sm text-text-secondary">
        {data ? `${data.pageCount} páginas` : "Pré-visualização"} - {year}
      </p>
    </div>
  );
}
