import { type MouseEvent, useRef, useState } from "react";
import { NewCollectionModal } from "./NewCollectionModal";
import { useTheme } from "../hooks/useTheme";
import { AppIconGlyph, useAppIcon } from "../lib/appIcon";
import type { LibraryCollection, LibraryDocument, LibraryRoute } from "../types/library";

type SidebarProps = {
  collections: LibraryCollection[];
  documents: LibraryDocument[];
  activeRoute: LibraryRoute;
  onRouteChange: (route: LibraryRoute) => void;
  onCreateCollection: (name: string, description: string, color: string) => Promise<void>;
  onRenameCollection: (collection: LibraryCollection, name: string) => Promise<void>;
  onUpdateCollection: (
    collection: LibraryCollection,
    updates: { name: string; description: string; color: string },
  ) => Promise<void>;
  onDeleteCollection: (collection: LibraryCollection) => Promise<void>;
  onEmptyAreaContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  onOpenSettings: () => void;
};

type NavItem = {
  label: string;
  icon: "list" | "clock" | "bookmark" | "heart" | "trash";
  route: LibraryRoute;
};

type CollectionDialogState =
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

function Icon({ name }: { name: NavItem["icon"] | "folder" | "search" | "plus" | "edit" | "gear" | "contrast" | "sun" | "moon" }) {
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
    // Favoritos (favorites-icon.svg da pasta de icones de referencia). viewBox
    // proprio 14x14; strokeWidth 1.16667 = mesmo peso visual dos demais icones.
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.16667}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11.0833 8.16667C11.9525 7.315 12.8333 6.29417 12.8333 4.95833C12.8333 4.10743 12.4953 3.29138 11.8936 2.6897C11.292 2.08802 10.4759 1.75 9.625 1.75C8.59833 1.75 7.875 2.04167 7 2.91667C6.125 2.04167 5.40167 1.75 4.375 1.75C3.5241 1.75 2.70804 2.08802 2.10637 2.6897C1.50469 3.29138 1.16667 4.10743 1.16667 4.95833C1.16667 6.3 2.04167 7.32083 2.91667 8.16667L7 12.25L11.0833 8.16667Z" />
      </svg>
    );
  }

  if (name === "trash") {
    // Lixeira (trash.svg da pasta de icones de referencia). viewBox proprio
    // 14x14; strokeWidth 1.16667 nesse viewBox = mesmo peso visual do
    // strokeWidth 2 no viewBox 24 dos demais icones.
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.16667}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1.75 3.5H12.25" />
        <path d="M11.0833 3.5V11.6667C11.0833 12.25 10.5 12.8333 9.91667 12.8333H4.08333C3.5 12.8333 2.91667 12.25 2.91667 11.6667V3.5" />
        <path d="M4.66667 3.5V2.33334C4.66667 1.75 5.25 1.16667 5.83333 1.16667H8.16667C8.75 1.16667 9.33333 1.75 9.33333 2.33334V3.5" />
        <path d="M5.83333 6.41667V9.91667" />
        <path d="M8.16667 6.41667V9.91667" />
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

  if (name === "sun") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    );
  }

  if (name === "moon") {
    return (
      <svg {...commonProps}>
        <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a7 7 0 1 0 11 11z" />
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
  onUpdateCollection,
  onDeleteCollection,
  onEmptyAreaContextMenu,
  onOpenSettings,
}: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { variant: appIconVariant } = useAppIcon();
  const [isNewCollectionModalOpen, setIsNewCollectionModalOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<LibraryCollection | null>(null);
  const [collectionDialog, setCollectionDialog] = useState<CollectionDialogState>(null);
  const [isSubmittingCollection, setIsSubmittingCollection] = useState(false);
  const [collectionContextMenu, setCollectionContextMenu] = useState<CollectionContextMenuState>(null);
  const [inlineEditingCollectionId, setInlineEditingCollectionId] = useState<string | null>(null);
  const [inlineCollectionName, setInlineCollectionName] = useState("");
  const skipInlineRenameBlurRef = useRef(false);
  // Contagem por colecao usada apenas nos dialogos de contexto/exclusao
  // (a listagem da sidebar nao exibe contadores, seguindo o Figma).
  const collectionCounts = new Map<string, number>();
  documents.forEach((document) => {
    collectionCounts.set(document.collection, (collectionCounts.get(document.collection) ?? 0) + 1);
  });

  function openCreateCollectionDialog() {
    setCollectionContextMenu(null);
    setIsNewCollectionModalOpen(true);
  }

  function openEditCollectionDialog(collection: LibraryCollection) {
    setCollectionContextMenu(null);
    setEditingCollection(collection);
  }

  function openDeleteCollectionDialog(collection: LibraryCollection) {
    setCollectionContextMenu(null);
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
    }
  }

  async function submitCollectionDialog() {
    if (!collectionDialog || isSubmittingCollection) {
      return;
    }

    setIsSubmittingCollection(true);
    try {
      await onDeleteCollection(collectionDialog.collection);
      setCollectionDialog(null);
    } catch (error) {
      console.error(getErrorMessage(error));
    } finally {
      setIsSubmittingCollection(false);
    }
  }

  function startInlineRename(collection: LibraryCollection) {
    setCollectionContextMenu(null);
    skipInlineRenameBlurRef.current = false;
    setInlineEditingCollectionId(collection.id);
    setInlineCollectionName(collection.name);
  }

  function cancelInlineRename() {
    skipInlineRenameBlurRef.current = true;
    setInlineEditingCollectionId(null);
    setInlineCollectionName("");
  }

  async function submitInlineRename(collection: LibraryCollection) {
    if (skipInlineRenameBlurRef.current) {
      skipInlineRenameBlurRef.current = false;
      return;
    }

    if (inlineEditingCollectionId !== collection.id) {
      return;
    }

    const nextName = inlineCollectionName.trim();
    if (nextName.length === 0 || nextName === collection.name) {
      setInlineEditingCollectionId(null);
      setInlineCollectionName("");
      return;
    }

    try {
      await onRenameCollection(collection, nextName);
      setInlineEditingCollectionId(null);
      setInlineCollectionName("");
    } catch (error) {
      console.error(getErrorMessage(error));
    }
  }

  async function submitEditingCollection(updates: { name: string; description: string; color: string }) {
    if (!editingCollection) {
      return;
    }

    await onUpdateCollection(editingCollection, updates);
  }

  return (
    <aside
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col border-r border-border-subtle bg-sidebar font-sans text-sidebar-text"
      onContextMenu={onEmptyAreaContextMenu}
    >
      <div className="flex items-center gap-3 px-5 pb-2 pt-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-text-inverse">
          <AppIconGlyph variant={appIconVariant} className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold text-[#2C1810] dark:text-[#F0E8DF]">Athenaeum</span>
      </div>

      <nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2 pt-3">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const active = isRouteActive(activeRoute, item.route);

            return (
              <button
                key={item.label}
                type="button"
                onClick={() => onRouteChange(item.route)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] leading-[19.5px] transition ${
                  active
                    ? "bg-sidebar-raised font-medium text-[#2C1810] dark:text-[#F0E8DF]"
                    : "font-normal text-sidebar-muted hover:bg-sidebar-raised"
                }`}
              >
                <span className={active ? "text-[#2C1810] dark:text-[#F0E8DF]" : "text-sidebar-muted"}>
                  <Icon name={item.icon} />
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 px-3 pb-2">
          {/* Mantido no #9E8878 base (nao acompanha a escurecida dos demais itens). */}
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#9E8878]">Minha biblioteca</span>
        </div>

        <div className="space-y-0.5">
          {collections.map((collection) => {
            const active = isRouteActive(activeRoute, { type: "collection", collectionName: collection.name });
            const isInlineEditing = inlineEditingCollectionId === collection.id;

            return (
              <div
                key={collection.id}
                onContextMenu={(event) => openCollectionContextMenu(event, collection)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] leading-[19.5px] transition ${
                  active
                    ? "bg-sidebar-raised font-semibold text-[#2C1810] dark:text-[#F0E8DF]"
                    : "font-normal text-sidebar-muted hover:bg-sidebar-raised"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: collection.color }}
                    aria-hidden="true"
                  />
                  {isInlineEditing ? (
                    <input
                      value={inlineCollectionName}
                      onChange={(event) => setInlineCollectionName(event.target.value)}
                      onBlur={() => void submitInlineRename(collection)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelInlineRename();
                        }
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      className="min-w-0 flex-1 rounded-md border border-border-muted bg-surface-panel px-1.5 py-0.5 text-[13px] font-semibold leading-[18px] text-text-primary outline-none focus:border-primary"
                      aria-label="Renomear coleção"
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => {
                        setCollectionContextMenu(null);
                        onRouteChange({ type: "collection", collectionName: collection.name });
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        startInlineRename(collection);
                      }}
                    >
                      {collection.name}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={openCreateCollectionDialog}
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-normal leading-[19.5px] text-sidebar-muted transition hover:bg-sidebar-raised hover:text-sidebar-text"
        >
          <Icon name="plus" />
          Nova coleção
        </button>
      </nav>

      <div className="flex items-center justify-between border-t border-sidebar-raised px-5 py-4">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] font-normal leading-[19.5px] text-sidebar-muted transition hover:bg-sidebar-raised hover:text-sidebar-text"
          title="Ajustes"
        >
          <span className="text-sidebar-muted">
            <Icon name="gear" />
          </span>
          Ajustes
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-raised text-sidebar-text transition hover:brightness-110"
          aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          title={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          aria-pressed={theme === "dark"}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
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
              Nova coleção
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left font-semibold hover:bg-sidebar-active hover:text-text-inverse"
              role="menuitem"
              onClick={() => openEditCollectionDialog(collectionContextMenu.collection)}
            >
              <Icon name="edit" />
              Editar coleção
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left font-semibold text-text-primary hover:bg-status-red hover:text-status-red-text"
              role="menuitem"
              onClick={() => openDeleteCollectionDialog(collectionContextMenu.collection)}
            >
              <Icon name="trash" />
              Excluir coleção
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
                Excluir coleção?
              </h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                {`Os ${collectionDialog.count} documentos desta coleção serão mantidos e movidos para outra coleção.`}
              </p>
            </header>

            <div className="px-6 py-5">
              <div className="rounded-lg border border-border-muted bg-surface-muted px-4 py-3 text-sm font-semibold text-text-primary">
                {collectionDialog.collection.name}
              </div>
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
                className="rounded-lg bg-status-red px-4 py-2 text-sm font-bold text-status-red-text transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-subtle disabled:shadow-none"
                onClick={() => void submitCollectionDialog()}
                disabled={isSubmittingCollection}
              >
                {isSubmittingCollection ? "Excluindo..." : "Excluir"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {editingCollection ? (
        <NewCollectionModal
          collection={editingCollection}
          onClose={() => setEditingCollection(null)}
          onCreateCollection={submitEditingCollection}
        />
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
