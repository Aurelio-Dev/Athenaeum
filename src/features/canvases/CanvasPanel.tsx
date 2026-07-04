import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, restore } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { BinaryFileData, ExcalidrawImperativeAPI, ExcalidrawInitialDataState, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import { getCanvasContent, loadCanvasFiles, saveCanvasContent, saveCanvasFile } from "../../lib/database";
import { useReaderPersistence } from "../reader/useReaderPersistence";
import { canvasPanelHeight, canvasPanelMinHeight, canvasPanelMinWidth, canvasPanelWidth } from "./canvasPanelDimensions";

// Fontes servidas localmente (public/excalidraw-assets/fonts): sem isso o
// Excalidraw baixa as fontes de um CDN (esm.sh) — inaceitavel num app
// offline-first. Definido no escopo do modulo: este componente e lazy-loaded,
// entao a atribuicao roda antes do primeiro mount do Excalidraw.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}
window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

// Tipos derivados da propria prop onChange da lib — evita imports profundos
// de subpacotes internos e acompanha upgrades de versao automaticamente.
type ExcalidrawOnChange = NonNullable<ExcalidrawProps["onChange"]>;
type SceneElements = Parameters<ExcalidrawOnChange>[0];
type SceneAppState = Parameters<ExcalidrawOnChange>[1];
type SceneFiles = Parameters<ExcalidrawOnChange>[2];

type SceneSnapshot = {
  elements: SceneElements;
  appState: SceneAppState;
  files: SceneFiles;
};

// Dimensoes vivem em canvasPanelDimensions.ts (modulo leve, compartilhado com
// o LibraryView sem puxar o chunk do Excalidraw).
const collapsedHeight = 42;

function getMaximizedPanelSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

// Subconjunto EXPLICITO do appState que persiste entre sessoes: viewport e
// fundo. O appState completo carrega estado volatil de sessao — collaborators
// (um Map, que o JSON.stringify vira {} e pode quebrar o load), cursores,
// menus abertos — que nunca deve ir para o banco.
function sanitizeAppState(appState: SceneAppState) {
  return {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom,
    viewBackgroundColor: appState.viewBackgroundColor,
    gridSize: appState.gridSize,
  };
}

// Classifica o erro do save_canvas_file: rejeicoes DETERMINISTICAS (validacao
// do backend — vao falhar sempre para o mesmo arquivo) versus falhas
// possivelmente transitorias (banco/disco — vale re-tentar). A classificacao
// e por substring das mensagens fixas do lib.rs; se as mensagens mudarem la,
// este filtro precisa acompanhar.
function isDeterministicRejection(message: string) {
  return (
    message.includes("10MB") ||
    message.includes("suportado") ||
    message.includes("invalido") ||
    message.includes("inválido")
  );
}

function rejectionToastMessage(backendMessage: string) {
  if (backendMessage.includes("10MB")) {
    return "Imagem removida do quadro: maior que o limite de 10MB.";
  }

  if (backendMessage.includes("suportado")) {
    return "Imagem removida do quadro: tipo de arquivo não suportado.";
  }

  return "Imagem removida do quadro: arquivo rejeitado ao salvar.";
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" x2="18" y1="12" y2="12" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M8 20H4v-4" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h12v12" />
      <path d="M4 8h12v12H4z" />
    </svg>
  );
}

function CanvasHeaderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

type CanvasPanelProps = {
  panel: FloatingPanel;
  title: string;
  onClose: () => void;
  // Avisa a listagem ("Editado ha X" do card) apos cada save.
  onCanvasChanged: () => void;
};

// EXCECAO DELIBERADA a regra "Esc fecha o painel do topo da pilha" (seguida
// por caderno, leitor e anotacoes): o Excalidraw usa Esc internamente —
// deselecionar ferramenta/selecao, fechar dialogos proprios. Capturar Esc
// aqui fecharia o painel no meio do desenho. O quadro fecha APENAS pelo
// botao ×, que garante o flush. Nao e um esquecimento.
export function CanvasPanel({ panel, title, onClose, onCanvasChanged }: CanvasPanelProps) {
  const canvasId = Number(panel.entityId);
  const { movePanel } = useFloatingPanels();

  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: canvasPanelWidth, height: canvasPanelHeight });
  const [isMaximized, setIsMaximized] = useState(false);
  const restoreStateRef = useRef<{
    position: { x: number; y: number };
    size: { width: number; height: number };
    collapsed: boolean;
  } | null>(null);

  // Cena corrente fora do estado React: o onChange do Excalidraw dispara a
  // cada interacao (ate movimento de ponteiro) — re-renderizar o painel por
  // evento seria desperdicio. O autosave le os refs no momento do save.
  const latestSceneRef = useRef<SceneSnapshot | null>(null);
  const isDirtyRef = useRef(false);
  // API imperativa do Excalidraw — usada para refresh() no fim do drag do
  // painel (re-medicao dos offsets do container; ver onMoveEnd no frame).
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // file_ids ja persistidos (carregados no inicio da sessao + salvos durante
  // ela): o diff contra o `files` do onChange decide o que enviar ao Rust.
  const persistedFileIdsRef = useRef<Set<string>>(new Set());
  // file_ids rejeitados de forma DETERMINISTICA pelo backend (>10MB, mime nao
  // suportado): nunca re-tentados nesta sessao.
  const rejectedFileIdsRef = useRef<Set<string>>(new Set());
  const onCanvasChangedRef = useRef(onCanvasChanged);
  onCanvasChangedRef.current = onCanvasChanged;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [contentJson, storedFiles] = await Promise.all([getCanvasContent(canvasId), loadCanvasFiles(canvasId)]);

        // Conteudo corrompido nao pode impedir o quadro de abrir: cai na
        // cena vazia e o proximo save regrava um JSON valido.
        let parsed: Parameters<typeof restore>[0] = null;
        try {
          parsed = JSON.parse(contentJson) as Parameters<typeof restore>[0];
        } catch {
          console.warn(`Conteudo do quadro ${canvasId} ilegivel; abrindo cena vazia.`);
        }

        // Reconstroi o objeto `files` que o Excalidraw espera: dataURL a
        // partir do (mime, base64) devolvido pelo comando Rust.
        const files: Record<string, BinaryFileData> = {};
        storedFiles.forEach((file) => {
          files[file.fileId] = {
            id: file.fileId as BinaryFileData["id"],
            mimeType: file.mimeType as BinaryFileData["mimeType"],
            dataURL: `data:${file.mimeType};base64,${file.dataBase64}` as BinaryFileData["dataURL"],
            created: Date.now(),
          };
        });

        // restore() oficial normaliza elements/appState contra a versao
        // instalada da lib (preenche defaults, descarta campos desconhecidos)
        // — protecao contra drift de schema entre versoes do Excalidraw.
        const restored = restore(parsed ? { ...parsed, files } : { files }, null, null);

        // Fundo creme (#F0E8DF, token do app) APENAS para cena nova: sem
        // conteudo persistido (parsed === null), o restore() cai no branco
        // padrao do Excalidraw. Um quadro ja existente tem parsed != null e
        // seu viewBackgroundColor salvo (sanitizeAppState persiste esse campo)
        // — nao sobrescrevemos, senao trocariamos o fundo escolhido pelo
        // usuario em quadros antigos. Corrompido tambem cai aqui (parsed null)
        // e abre creme, o que e o comportamento desejado para "comecar do zero".
        if (parsed === null) {
          restored.appState.viewBackgroundColor = "#F0E8DF";
        }

        if (cancelled) {
          return;
        }

        persistedFileIdsRef.current = new Set(storedFiles.map((file) => file.fileId));
        setInitialData(restored as ExcalidrawInitialDataState);
      } catch (error) {
        console.warn("Nao foi possivel carregar o quadro.", error);
        if (!cancelled) {
          setLoadError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canvasId]);

  // Remove da cena os elementos de imagem que apontam para o arquivo rejeitado
  // e avisa o usuario com o toast nativo do Excalidraw. Sem a remocao, o
  // elemento ficaria salvo no content apontando para um arquivo que nunca
  // existira em disco — placeholder quebrado ao reabrir o quadro.
  const removeRejectedImage = useCallback((fileId: string, backendMessage: string) => {
    const api = excalidrawApiRef.current;
    if (!api) {
      return;
    }

    const remainingElements = api
      .getSceneElements()
      .filter((element) => !("fileId" in element) || element.fileId !== fileId);
    // updateScene dispara onChange, que re-marca dirty e agenda um novo save —
    // o content e regravado sem o elemento removido.
    api.updateScene({ elements: [...remainingElements] });
    api.setToast({ message: rejectionToastMessage(backendMessage), closable: true });
  }, []);

  const persistScene = useCallback(async () => {
    const scene = latestSceneRef.current;

    if (!isDirtyRef.current || !scene) {
      return;
    }

    isDirtyRef.current = false;

    // 1) Cena (SEM imagens) no banco — elementos deletados ficam de fora,
    // e o appState passa pelo subset explicito.
    try {
      const content = JSON.stringify({
        elements: scene.elements.filter((element) => !element.isDeleted),
        appState: sanitizeAppState(scene.appState),
      });
      await saveCanvasContent(canvasId, content);
      onCanvasChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel salvar o quadro.", error);
      // Marca sujo de novo: o proximo onChange/fechamento tenta outra vez.
      isDirtyRef.current = true;
      return;
    }

    // 2) Imagens NOVAS para o comando Rust. O dataURL ja e base64 — so
    // recortamos o prefixo "data:...;base64," e repassamos a string.
    //
    // try/catch POR ARQUIVO: uma imagem rejeitada nao pode abortar o loop e
    // bloquear a persistencia das irmas (ex.: colar uma imagem de 12MB e
    // depois uma valida — sem o isolamento, a valida nunca seria salva).
    for (const [fileId, file] of Object.entries(scene.files)) {
      if (persistedFileIdsRef.current.has(fileId) || rejectedFileIdsRef.current.has(fileId)) {
        continue;
      }

      const commaIndex = file.dataURL.indexOf(",");
      if (commaIndex === -1) {
        continue;
      }

      try {
        await saveCanvasFile(canvasId, {
          fileId,
          mimeType: file.mimeType,
          dataBase64: file.dataURL.slice(commaIndex + 1),
        });
        persistedFileIdsRef.current.add(fileId);
      } catch (error) {
        // O invoke do Tauri rejeita com a STRING do Err do Rust.
        const message = error instanceof Error ? error.message : String(error);

        if (isDeterministicRejection(message)) {
          // Falha que vai acontecer SEMPRE (>10MB, mime nao suportado):
          // marca para nunca re-tentar e remove a imagem da cena com aviso.
          // Sem essa marcacao, cada autosave re-serializava e re-enviava o
          // arquivo condenado pelo IPC so para ser rejeitado de novo.
          rejectedFileIdsRef.current.add(fileId);
          removeRejectedImage(fileId, message);
        } else {
          // Falha possivelmente transitoria (banco ocupado, disco): mantem o
          // arquivo elegivel e re-marca dirty para tentar no proximo save.
          console.warn(`Falha transitoria ao salvar arquivo ${fileId} do quadro.`, error);
          isDirtyRef.current = true;
        }
      }
    }
  }, [canvasId, removeRejectedImage]);

  // Mesmo debouncer generico do resto do app (posicao de leitura usa 750ms).
  const { schedule, cancel } = useReaderPersistence(() => void persistScene(), 750);

  const handleChange: ExcalidrawOnChange = (elements, appState, files) => {
    latestSceneRef.current = { elements, appState, files };
    isDirtyRef.current = true;
    schedule();
  };

  const handleClose = useCallback(async () => {
    // Flush no fechamento: nunca depender so do debounce para o momento de
    // fechar (mesmo principio do leitor de PDF e das notas).
    cancel();
    await persistScene();
    onClose();
  }, [cancel, persistScene, onClose]);

  const refreshExcalidrawSoon = useCallback(() => {
    window.requestAnimationFrame(() => {
      excalidrawApiRef.current?.refresh();
    });
  }, []);

  const toggleCollapsed = useCallback(async () => {
    if (!isCollapsed) {
      cancel();
      await persistScene();
    }

    setIsCollapsed((current) => !current);
    refreshExcalidrawSoon();
  }, [cancel, isCollapsed, persistScene, refreshExcalidrawSoon]);

  const toggleMaximized = useCallback(() => {
    if (isMaximized) {
      const restoreState = restoreStateRef.current;

      if (restoreState) {
        setPanelSize(restoreState.size);
        setIsCollapsed(restoreState.collapsed);
        movePanel(panel.id, restoreState.position);
      }

      setIsMaximized(false);
      refreshExcalidrawSoon();
      return;
    }

    restoreStateRef.current = {
      position: panel.position,
      size: panelSize,
      collapsed: isCollapsed,
    };
    setIsCollapsed(false);
    setPanelSize(getMaximizedPanelSize());
    movePanel(panel.id, { x: 0, y: 0 });
    setIsMaximized(true);
    refreshExcalidrawSoon();
  }, [isCollapsed, isMaximized, movePanel, panel.id, panel.position, panelSize, refreshExcalidrawSoon]);

  useEffect(() => {
    if (!isMaximized) {
      return;
    }

    function handleWindowResize() {
      setPanelSize(getMaximizedPanelSize());
      movePanel(panel.id, { x: 0, y: 0 });
      refreshExcalidrawSoon();
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isMaximized, movePanel, panel.id, refreshExcalidrawSoon]);

  // Best-effort no unmount (painel fechado por outra via): salva o que
  // estiver sujo. persistScene e estavel (useCallback [canvasId]).
  useEffect(() => {
    return () => {
      void persistScene();
    };
  }, [persistScene]);

  return (
    <FloatingPanelFrame
      panel={panel}
      width={panelSize.width}
      height={isCollapsed ? collapsedHeight : panelSize.height}
      minWidth={canvasPanelMinWidth}
      minHeight={isCollapsed ? collapsedHeight : canvasPanelMinHeight}
      resizable={!isCollapsed && !isMaximized}
      edgeToEdge={isMaximized}
      onMoveEnd={() => excalidrawApiRef.current?.refresh()}
      renderHeader={(startDragging) => (
        <div
          className={`flex h-10 shrink-0 items-center justify-between bg-[var(--surface-header)] px-4 ${
            isMaximized ? "" : "cursor-move"
          }`}
          onMouseDown={isMaximized ? undefined : startDragging}
        >
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold text-white">
            <span className="shrink-0 text-white/80">
              <CanvasHeaderIcon />
            </span>
            <span className="truncate">{title || "Quadro"}</span>
          </h2>
          <div className="flex items-center gap-1" onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
              title={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
              className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
              onClick={() => void toggleCollapsed()}
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              aria-label={isMaximized ? "Restaurar painel" : "Maximizar painel"}
              title={isMaximized ? "Restaurar painel" : "Maximizar painel"}
              className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
              onClick={toggleMaximized}
            >
              {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button
              type="button"
              aria-label="Fechar painel"
              title="Fechar painel"
              className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
              onClick={() => void handleClose()}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
    >
      {isCollapsed ? null : isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm font-semibold text-text-secondary">
          Carregando quadro
        </div>
      ) : loadError ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm font-semibold text-status-red-text">
          Nao foi possivel carregar o quadro.
        </div>
      ) : (
        <div className="canvas-panel-editor min-h-0 flex-1">
          <Excalidraw
            excalidrawAPI={(api) => {
              excalidrawApiRef.current = api;
            }}
            initialData={initialData}
            onChange={handleChange}
            langCode="pt-BR"
            UIOptions={{
              canvasActions: {
                clearCanvas: false,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                saveAsImage: false,
                toggleTheme: false,
              },
            }}
          >
            {/* MainMenu vazio substitui os itens padrao; o botao hamburguer
                remanescente e escondido via CSS (.canvas-panel-editor no
                index.css) — primeira aproximacao combinada. */}
            <MainMenu />
          </Excalidraw>
        </div>
      )}
    </FloatingPanelFrame>
  );
}
