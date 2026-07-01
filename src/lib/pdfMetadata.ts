import { invoke } from "@tauri-apps/api/core";

// Metadados extraidos de um PDF. Strings vazias quando o campo nao existe no
// arquivo — o modal decide o fallback (nome do arquivo, ano atual, etc).
export type PdfMetadata = {
  title: string;
  authors: string;
  year: string;
};

const emptyPdfMetadata: PdfMetadata = { title: "", authors: "", year: "" };

function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

// O dicionario Info do PDF nao e fortemente tipado pelo pdf.js; lemos cada campo
// defensivamente como string.
function readInfoString(info: Record<string, unknown>, key: string): string {
  const value = info[key];
  return typeof value === "string" ? value.trim() : "";
}

// CreationDate vem no formato PDF "D:YYYYMMDDHHmmSS±HH'mm'". So o ano interessa.
function parseYear(creationDate: string): string {
  const match = /D:(\d{4})/.exec(creationDate);

  if (!match) {
    return "";
  }

  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? String(year) : "";
}

// Extrai titulo/autor/ano da primeira leitura do PDF. Assincrono e tolerante a
// falha (PDF corrompido, sem metadados): devolve campos vazios em vez de lancar,
// para o modal seguir mostrando o formulario editavel.
export async function extractPdfMetadata(filePath: string): Promise<PdfMetadata> {
  const [pdfjsLib, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.mjs?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;

  let base64: string;

  try {
    base64 = await invoke<string>("read_pdf_file", { filePath });
  } catch (error) {
    console.warn("Nao foi possivel ler o PDF para extrair metadados.", error);
    return emptyPdfMetadata;
  }

  const loadingTask = pdfjsLib.getDocument({ data: base64ToBytes(base64) });

  try {
    const pdf = await loadingTask.promise;
    const { info } = await pdf.getMetadata();
    const infoRecord = info as unknown as Record<string, unknown>;

    return {
      title: readInfoString(infoRecord, "Title"),
      authors: readInfoString(infoRecord, "Author"),
      year: parseYear(readInfoString(infoRecord, "CreationDate")),
    };
  } catch (error) {
    console.warn("Nao foi possivel extrair metadados do PDF.", error);
    return emptyPdfMetadata;
  } finally {
    void loadingTask.destroy();
  }
}
