import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import type { LibraryCollection, LibraryDocument, LibraryRoute } from "../types/library";

type AppShellProps = {
  collections: LibraryCollection[];
  documents: LibraryDocument[];
  trashCount: number;
  activeRoute: LibraryRoute;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onRouteChange: (route: LibraryRoute) => void;
  onCreateCollection: (name: string, description: string) => Promise<void>;
  onRenameCollection: (collection: LibraryCollection, name: string, description: string) => Promise<void>;
  onDeleteCollection: (collection: LibraryCollection) => Promise<void>;
  children: ReactNode;
};

export function AppShell({
  collections,
  documents,
  trashCount,
  activeRoute,
  searchTerm,
  onSearchTermChange,
  onRouteChange,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  children,
}: AppShellProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface-app text-text-primary">
      <Sidebar
        collections={collections}
        documents={documents}
        trashCount={trashCount}
        activeRoute={activeRoute}
        searchTerm={searchTerm}
        onSearchTermChange={onSearchTermChange}
        onRouteChange={onRouteChange}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
