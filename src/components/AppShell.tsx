import type { ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Sidebar } from "./Sidebar";
import type { LibraryCollection, LibraryDocument, LibraryRoute } from "../types/library";

type AppShellProps = {
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
  onEmptyAreaContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  onOpenSettings: () => void;
  children: ReactNode;
};

export function AppShell({
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
  children,
}: AppShellProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface-app text-text-primary">
      <Sidebar
        collections={collections}
        documents={documents}
        activeRoute={activeRoute}
        onRouteChange={onRouteChange}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onUpdateCollection={onUpdateCollection}
        onDeleteCollection={onDeleteCollection}
        onEmptyAreaContextMenu={onEmptyAreaContextMenu}
        onOpenSettings={onOpenSettings}
      />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
