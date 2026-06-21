import { IconButton } from "./IconButton";
import type { LibraryCollection, LibraryDocument, LibraryRoute } from "../types/library";

type SidebarProps = {
  collections: LibraryCollection[];
  documents: LibraryDocument[];
  trashCount: number;
  activeRoute: LibraryRoute;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onRouteChange: (route: LibraryRoute) => void;
};

type NavItem = {
  label: string;
  icon: "list" | "clock" | "heart" | "trash";
  count?: number;
  route: LibraryRoute;
};

const navItems = (documents: LibraryDocument[], trashCount: number): NavItem[] => [
  { label: "Todos os itens", icon: "list", count: documents.length, route: { type: "all" } },
  { label: "Recentes", icon: "clock", route: { type: "recent" } },
  { label: "Favoritos", icon: "heart", count: documents.filter((document) => document.favorite).length, route: { type: "favorites" } },
  { label: "Lixeira", icon: "trash", count: trashCount, route: { type: "trash" } },
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

function Icon({ name }: { name: NavItem["icon"] | "folder" | "search" | "brand" | "plus" }) {
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
        <line x1="4" x2="20" y1="7" y2="7" />
        <line x1="7" x2="17" y1="12" y2="12" />
        <line x1="10" x2="14" y1="17" y2="17" />
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
  trashCount,
  activeRoute,
  searchTerm,
  onSearchTermChange,
  onRouteChange,
}: SidebarProps) {
  const collectionCounts = new Map<string, number>();
  documents.forEach((document) => {
    collectionCounts.set(document.collection, (collectionCounts.get(document.collection) ?? 0) + 1);
  });

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-black bg-sidebar text-sidebar-text">
      <div className="flex items-center gap-3 px-5 pb-2 pt-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-text-inverse">
          <Icon name="brand" />
        </div>
        <span className="text-lg font-bold text-text-inverse">Athenaeum</span>
      </div>

      <div className="px-4 py-3">
        <label className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-raised px-3 py-2.5 text-sidebar-muted">
          <Icon name="search" />
          <input
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Buscar na biblioteca..."
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-sidebar-text outline-none placeholder:text-sidebar-muted"
          />
          <span className="rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[11px] text-sidebar-muted">⌘K</span>
        </label>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-1">
          {navItems(documents, trashCount).map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onRouteChange(item.route)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                isRouteActive(activeRoute, item.route) ? "bg-sidebar-active text-text-inverse" : "text-sidebar-text hover:bg-sidebar-raised"
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Icon name={item.icon} />
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.count === "number" ? (
                <span className="rounded-full bg-sidebar-raised px-2 py-0.5 text-xs text-sidebar-text">{item.count}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between px-3 pb-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-sidebar-muted">Coleções</span>
          <IconButton label="Nova coleção" variant="ghost">
            <Icon name="plus" />
          </IconButton>
        </div>

        <div className="space-y-1">
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              onClick={() => onRouteChange({ type: "collection", collectionName: collection.name })}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                isRouteActive(activeRoute, { type: "collection", collectionName: collection.name })
                  ? "bg-sidebar-active text-text-inverse"
                  : "text-sidebar-text hover:bg-sidebar-raised"
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Icon name="folder" />
                <span className="truncate">{collection.name}</span>
              </span>
              <span className="rounded-full bg-sidebar-raised px-2 py-0.5 text-xs text-sidebar-text">
                {collectionCounts.get(collection.name) ?? 0}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-primary transition hover:bg-sidebar-raised"
        >
          <Icon name="plus" />
          Nova coleção
        </button>
      </nav>

      <div className="flex items-center gap-3 border-t border-sidebar-raised px-5 py-4">
        <span className="h-2.5 w-2.5 rounded-full bg-status-green-text ring-4 ring-status-green" />
        <span className="text-xs text-sidebar-muted">Sincronizado · há instantes</span>
      </div>
    </aside>
  );
}
