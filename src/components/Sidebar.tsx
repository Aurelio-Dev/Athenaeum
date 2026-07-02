import { type MouseEvent, useEffect, useState } from "react";
import { NewCollectionModal } from "./NewCollectionModal";
import type { LibraryCollection, LibraryDocument, LibraryRoute } from "../types/library";

type SidebarProps = {
  collections: LibraryCollection[];
  documents: LibraryDocument[];
  activeRoute: LibraryRoute;
  onRouteChange: (route: LibraryRoute) => void;
  onCreateCollection: (name: string, description: string, color: string) => Promise<void>;
  onRenameCollection: (collection: LibraryCollection, name: string) => Promise<void>;
  onDeleteCollection: (collection: LibraryCollection) => Promise<void>;
};

type NavItem = {
  label: string;
  icon: "list" | "clock" | "bookmark" | "heart" | "trash";
  route: LibraryRoute;
};

type CollectionDialogState =
  | { type: "edit"; collection: LibraryCollection }
  | { type: "delete"; collection: LibraryCollection; count: number }
  | null;

type CollectionContextMenuState = {
  collection: LibraryCollection;
  count: number;
  x: number;
  y: number;
} | null;

// Sem contadores numericos, seguindo o layout do Figma. "Todos os itens" nao
// existe no Figma mas e mantido: sem ele nao ha rota para ver a biblioteca
// inteira de uma vez.
const navItems: NavItem[] = [
  { label: "Todos os itens", icon: "list", route: { type: "all" } },
  { label: "Recentes", icon: "clock", route: { type: "recent" } },
  { label: "Reading List", icon: "bookmark", route: { type: "reading-list" } },
  { label: "Favoritos", icon: "heart", route: { type: "favorites" } },
  { label: "Lixeira", icon: "trash", route: { type: "trash" } },
];

// Persistencia da escolha de tema entre sessoes. A classe .dark no <html>
// ativa as variaveis CSS do tema escuro (ver styles/index.css).
const themeStorageKey = "athenaeum-theme";

function readStoredTheme(): "light" | "dark" {
  return window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
}

function isRouteActive(activeRoute: LibraryRoute, route: LibraryRoute) {
  if (activeRoute.type !== route.type) {
    return false;
  }

  if (activeRoute.type === "collection" && route.type === "collection") {
    return activeRoute.collectionName === route.collectionName;
  }

  return true;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Erro desconhecido.";
}

function Icon({ name }: { name: NavItem["icon"] | "folder" | "search" | "brand" | "plus" | "edit" | "gear" | "contrast" }) {
  const commonProps = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "brand") {
    return (
      <svg {...commonProps} strokeWidth={2.4}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9" />
        <path d="M9.5 20v-6h5v6" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg {...commonProps}>
        <circle cx="11" cy="11" r="7" />
        <line x1="20.5" x2="16.5" y1="20.5" y2="16.5" />
      </svg>
    );
  }

  if (name === "clock") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    );
  }

  if (name === "heart") {
    return (
      <svg {...commonProps}>
        <path d="M12 20s-7-4.6-7-9.4A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 2.6C19 15.4 12 20 12 20z" />
      </svg>
    );
  }

  if (name === "trash") {
    return (
      <svg {...commonProps}>
        <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
      </svg>
    );
  }

  if (name === "bookmark") {
    return (
      <svg {...commonProps}>
        <path d="M6 4.5h12A0.5 0.5 0 0 1 18.5 5v15.5L12 16l-6.5 4.5V5A0.5 0.5 0 0 1 6 4.5z" />
      </svg>
    );
  }

  if (name === "gear") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  }

  if (name === "contrast") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5z" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (name === "folder") {
    return (
      <svg {...commonProps}>
        <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      </svg>
    );
  }

  if (name === "plus") {
    return (
      <svg {...commonProps}>
        <line x1="12" x2="12" y1="5" y2="19" />
        <line x1="5" x2="19" y1="12" y2="12" />
      </svg>
    );
  }

  if (name === "edit") {
    return (
      <svg {...commonProps}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <line x1="8" x2="20" y1="6" y2="6" />
      <line x1="8" x2="20" y1="12" y2="12" />
      <line x1="8" x2="20" y1="18" y2="18" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  );
}

export function Sidebar({
  collections,
  documents,
  activeRoute,
  onRouteChange,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
}: SidebarProps) {
  const [isNewCollectionModalOpen, setIsNewCollectionModalOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(readStoredTheme);
  const [collectionDialog, setCollectionDialog] = useState<CollectionDialogState>(null);
  const [collectionName, setCollectionName] = useState("");
  const [collectionError, setCollectionError] = useState("");
  const [isSubmittingCollection, setIsSubmittingCollection] = useState(false);
  const [collectionContextMenu, setCollectionContextMenu] = useState<CollectionContextMenuState>(null);
  // Contagem por colecao usada apenas nos dialogos de contexto/exclusao
  // (a listagem da sidebar nao exibe contadores, seguindo o Figma).
  const collectionCounts = new Map<string, number>();
  documents.forEach((document) => {
    collectionCounts.set(document.collection, (collectionCounts.get(document.collection) ?? 0) + 1);
  });

  // Aplica o tema no elemento raiz e persiste a escolha. Roda no mount (para
  // restaurar a preferencia salva) e a cada troca pelo botao do rodape.
  useEffect(() => {
    window.document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  function openCreateCollectionDialog() {
    setCollectionContextMenu(null);
    setIsNewCollectionModalOpen(true);
  }

  function openEditCollectionDialog(collection: LibraryCollection) {
    setCollectionContextMenu(null);
    setCollectionName(collection.name);
    setCollectionError("");
    setCollectionDialog({ type: "edit", collection });
  }

  function openDeleteCollectionDialog(collection: LibraryCollection) {
    setCollectionContextMenu(null);
    setCollectionName(collection.name);
    setCollectionError("");
    setCollectionDialog({ type: "delete", collection, count: collectionCounts.get(collection.name) ?? 0 });
  }

  function openCollectionContextMenu(event: MouseEvent, collection: LibraryCollection) {
    event.preventDefault();
    event.stopPropagation();
    setCollectionContextMenu({
      collection,
      count: collectionCounts.get(collection.name) ?? 0,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function closeCollectionDialog() {
    if (!isSubmittingCollection) {
      setCollectionDialog(null);
      setCollectionError("");
    }
  }

  async function submitCollectionDialog() {
    if (!collectionDialog || isSubmittingCollection) {
      return;
    }

    setIsSubmittingCollection(true);
    setCollectionError("");

    try {
      if (collectionDialog.type === "edit") {
        await onRenameCollection(collectionDialog.collection, collectionName);
      } else {
        await onDeleteCollection(collectionDialog.collection);
      }

      setCollectionDialog(null);
    } catch (error) {
      setCollectionError(getErrorMessage(error));
    } finally {
      setIsSubmittingCollection(false);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-[300px] shrink-0 flex-col border-r border-border-subtle bg-sidebar text-sidebar-text">
      <div className="flex items-center gap-3 px-5 pb-2 pt-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-text-inverse">
          <Icon name="brand" />
        </div>
        <span className="text-lg font-bold text-sidebar-text">Athenaeum</span>
      </div>

      <nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2 pt-3">
        <div className="space-y-1">
          {navItems.map((item) => {
            const active = isRouteActive(activeRoute, item.route);

            return (
              <button
                key={item.label}
                type="button"
                onClick={() => onRouteChange(item.route)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-sidebar-text transition ${
                  active ? "bg-sidebar-raised" : "hover:bg-sidebar-raised"
                }`}
              >
                <span className={active ? "text-primary" : "text-sidebar-muted"}>
                  <Icon name={item.icon} />
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 px-3 pb-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-sidebar-muted">Minha biblioteca</span>
        </div>

        <div className="space-y-1">
          {collections.map((collection) => {
            const active = isRouteActive(activeRoute, { type: "collection", collectionName: collection.name });

            return (
              <div
                key={collection.id}
                onContextMenu={(event) => openCollectionContextMenu(event, collection)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold text-sidebar-text transition ${
                  active ? "bg-sidebar-raised" : "hover:bg-sidebar-raised"
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => {
                    setCollectionContextMenu(null);
                    onRouteChange({ type: "collection", collectionName: collection.name });
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: collection.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{collection.name}</span>
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={openCreateCollectionDialog}
          className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-sidebar-muted transition hover:bg-sidebar-raised hover:text-sidebar-text"
        >
          <Icon name="plus" />
          Nova coleção
        </button>
      </nav>

      <div className="flex items-center justify-between border-t border-sidebar-raised px-5 py-4">
        {/* Tela de ajustes ainda nao existe; o botao marca o lugar dela no layout. */}
        <button
          type="button"
          className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-semibold text-sidebar-text transition hover:bg-sidebar-raised"
          title="Ajustes (em breve)"
        >
          <span className="text-sidebar-muted">
            <Icon name="gear" />
          </span>
          Ajustes
        </button>
        <button
          type="button"
          onClick={() => setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-raised text-sidebar-text transition hover:brightness-110"
          aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          title={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          aria-pressed={theme === "dark"}
        >
          <Icon name="contrast" />
        </button>
      </div>
      {collectionContextMenu ? (
        <div
          className="fixed inset-0 z-[65]"
          role="presentation"
          onMouseDown={() => setCollectionContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setCollectionContextMenu(null);
          }}
        >
          <div
            className="absolute w-52 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-raised py-1 text-sm text-sidebar-text shadow-2xl"
            style={{ left: collectionContextMenu.x, top: collectionContextMenu.y }}
            role="menu"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left font-semibold hover:bg-sidebar-active hover:text-text-inverse"
              role="menuitem"
              onClick={openCreateCollectionDialog}
            >
              <Icon name="plus" />
              Nova colecao
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left font-semibold hover:bg-sidebar-active hover:text-text-inverse"
              role="menuitem"
              onClick={() => openEditCollectionDialog(collectionContextMenu.collection)}
            >
              <Icon name="edit" />
              Editar colecao
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left font-semibold text-status-red-text hover:bg-status-red"
              role="menuitem"
              onClick={() => openDeleteCollectionDialog(collectionContextMenu.collection)}
            >
              <Icon name="trash" />
              Excluir colecao
            </button>
          </div>
        </div>
      ) : null}

      {collectionDialog ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay-modal p-6" role="presentation" onMouseDown={closeCollectionDialog}>
          <section
            className="w-full max-w-md rounded-xl bg-surface-panel text-text-primary shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collection-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="border-b border-border-subtle px-6 py-5">
              <h2 id="collection-dialog-title" className="text-lg font-bold">
                {collectionDialog.type === "edit" ? "Editar colecao" : "Excluir colecao?"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                {collectionDialog.type === "delete"
                  ? `Os ${collectionDialog.count} documentos desta colecao serao mantidos e movidos para outra colecao.`
                  : "Renomeie a colecao para manter sua biblioteca organizada."}
              </p>
            </header>

            <div className="px-6 py-5">
              {collectionDialog.type === "delete" ? (
                <div className="rounded-lg border border-border-muted bg-surface-muted px-4 py-3 text-sm font-semibold text-text-primary">
                  {collectionDialog.collection.name}
                </div>
              ) : (
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-text-primary">Nome</span>
                  <input
                    value={collectionName}
                    onChange={(event) => setCollectionName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitCollectionDialog();
                      }
                    }}
                    className="rounded-lg border border-border-muted px-3 py-2 text-sm outline-none focus:border-primary"
                    autoFocus
                  />
                </label>
              )}

              {collectionError ? (
                <div className="mt-4 rounded-lg bg-status-red px-4 py-3 text-sm font-semibold text-status-red-text">{collectionError}</div>
              ) : null}
            </div>

            <footer className="flex justify-end gap-3 border-t border-border-subtle px-6 py-4">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                onClick={closeCollectionDialog}
                disabled={isSubmittingCollection}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
                  collectionDialog.type === "delete"
                    ? "bg-status-red text-status-red-text hover:brightness-95"
                    : "bg-primary text-text-inverse shadow-button hover:bg-primary-hover"
                } disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-subtle disabled:shadow-none`}
                onClick={() => void submitCollectionDialog()}
                disabled={isSubmittingCollection}
              >
                {isSubmittingCollection
                  ? "Salvando..."
                  : collectionDialog.type === "edit"
                    ? "Salvar"
                    : "Excluir"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {isNewCollectionModalOpen ? (
        <NewCollectionModal
          onClose={() => setIsNewCollectionModalOpen(false)}
          onCreateCollection={({ name, description, color }) => onCreateCollection(name, description, color)}
        />
      ) : null}
    </aside>
  );
}
