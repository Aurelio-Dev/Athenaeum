import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listAvailableTagsFromPreloadedDatabase,
  listCollections,
  listLibraryDocuments,
} from "../../lib/database";
import type { LibraryCollection, LibraryDocument, SubjectTag } from "../../types/library";
import { NotebookContent } from "./NotebookContent";

type NotebookWindowRootProps = {
  notebookId: number;
};

type NotebookWindowBootstrap = {
  collections: LibraryCollection[];
  documents: LibraryDocument[];
};

// Raiz do Caderno em janela nativa do SO (?notebookPanel=1&notebookId=N).
// Mesmo modelo da ReaderPanelPopout: TODA leitura/escrita usa o pool
// "preloaded" — o banco e carregado pelo preload do plugin SQL no Rust
// (tauri.conf.json), entao nenhuma janela precisa (nem deve) chamar
// Database.load de novo; um load aqui recriaria o pool por baixo das outras
// janelas. Por isso o bootstrap abaixo e o databaseSource="preloaded" do
// NotebookContent.
export function NotebookWindowRoot({ notebookId }: NotebookWindowRootProps) {
  const [bootstrap, setBootstrap] = useState<NotebookWindowBootstrap | null>(null);
  const [availableTags, setAvailableTags] = useState<SubjectTag[]>([]);
  const [loadError, setLoadError] = useState(false);
  // Fecha com flush, deduplicado (X nativo + botao Fechar podem correr).
  const requestCloseRef = useRef<(() => Promise<void>) | null>(null);
  const closeWindowPromiseRef = useRef<Promise<void> | null>(null);

  const hasValidNotebookId = Number.isInteger(notebookId) && notebookId > 0;

  useEffect(() => {
    if (!hasValidNotebookId) {
      setLoadError(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Vocabulario que o LibraryView passaria por prop ao painel interno:
        // colecoes (drawer de Detalhes), biblioteca inteira (picker de PDF) e
        // tags. A janela e standalone, entao carrega do zero.
        const [collections, documents, tags] = await Promise.all([
          listCollections("preloaded"),
          listLibraryDocuments({ searchTerm: "", sortMode: "recentes", route: { type: "all" } }, "preloaded"),
          listAvailableTagsFromPreloadedDatabase(),
        ]);

        if (cancelled) {
          return;
        }

        setAvailableTags(tags);
        setBootstrap({ collections, documents });
      } catch (error) {
        console.warn("Nao foi possivel carregar os dados da janela do Caderno.", error);
        if (!cancelled) {
          setLoadError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasValidNotebookId, notebookId]);

  // Destroi a janela via comando Rust (mesmo racional do
  // close_reader_panel_window): o destroy nao reemite CloseRequested, entao o
  // listener abaixo nao entra em recursao. E o onClose passado ao conteudo —
  // quando ele roda, o flush interno do NotebookContent ja aconteceu.
  const destroyWindow = useCallback(() => {
    void invoke("close_notebook_window", { notebookId }).catch((error) => {
      console.warn("Nao foi possivel fechar a janela do Caderno.", error);
    });
  }, [notebookId]);

  // X nativo do SO: intercepta (preventDefault), roda o MESMO fecha-com-flush
  // do botao Fechar interno (requestClose = flush + onClose -> destroy) e so
  // entao a janela morre — digitacao recente nunca se perde. Padrao replicado
  // da ReaderPanelPopout (onCloseRequested + comando Rust com destroy).
  const closeWindow = useCallback(async () => {
    if (closeWindowPromiseRef.current) {
      return closeWindowPromiseRef.current;
    }

    const closePromise = (async () => {
      const requestClose = requestCloseRef.current;

      if (!requestClose) {
        // Conteudo ainda nao montou (carregando/erro): nada a gravar.
        destroyWindow();
        return;
      }

      try {
        await requestClose();
      } catch (error) {
        console.warn("Nao foi possivel concluir o fechamento da janela do Caderno.", error);
        throw error;
      }
    })();

    closeWindowPromiseRef.current = closePromise;
    try {
      await closePromise;
    } finally {
      if (closeWindowPromiseRef.current === closePromise) {
        closeWindowPromiseRef.current = null;
      }
    }
  }, [destroyWindow]);

  useEffect(() => {
    let isDisposed = false;
    const listenerRegistration: { unlisten: (() => void) | null } = { unlisten: null };

    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void closeWindow().catch(() => undefined);
      })
      .then((removeListener) => {
        if (isDisposed) {
          removeListener();
          return;
        }

        listenerRegistration.unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Nao foi possivel interceptar o fechamento da janela do Caderno.", error);
      });

    return () => {
      isDisposed = true;
      listenerRegistration.unlisten?.();
    };
  }, [closeWindow]);

  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)] px-6 text-center text-sm font-semibold text-status-red-text">
        Não foi possível carregar o caderno.
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)] text-sm font-semibold text-[var(--muted-foreground)]">
        Carregando...
      </div>
    );
  }

  return (
    <NotebookContent
      notebookId={notebookId}
      collections={bootstrap.collections}
      documents={bootstrap.documents}
      availableTags={availableTags}
      onAvailableTagsChange={setAvailableTags}
      onClose={destroyWindow}
      // Janela dedicada: nao ha listagem de cadernos para invalidar aqui; a
      // Fase 3 decide como avisar a janela principal.
      onNotebookChanged={() => undefined}
      // Janela propria nao disputa atalhos com pilha nenhuma: sempre ativa.
      isActiveForShortcuts={true}
      databaseSource="preloaded"
      // Esc nao fecha janela nativa (perder a janela num Esc reflexo nao e
      // convencao de SO); os degraus de overlay do Esc continuam valendo.
      closeOnEscape={false}
    >
      {({ renderHeader, body, requestClose }) => {
        // Guarda o fecha-com-flush corrente para o interceptador do X nativo.
        // Atribuicao durante o render e proposital: o listener so le o ref em
        // resposta a evento do SO, nunca durante o render.
        requestCloseRef.current = requestClose;

        return (
          // Mesma casca que o FloatingPanelFrame da ao conteudo (header +
          // corpo em coluna com min-h-0), so que ocupando a janela inteira —
          // sem drag (startDragging omitido: o SO arrasta pela barra de
          // titulo) e sem botoes de minimizar/maximizar (o SO ja os tem).
          <div className="flex h-screen flex-col overflow-hidden bg-[var(--card)]">
            {renderHeader()}
            <div className="flex min-h-0 flex-1 flex-col">{body}</div>
          </div>
        );
      }}
    </NotebookContent>
  );
}
