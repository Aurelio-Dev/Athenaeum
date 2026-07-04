import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuDivider } from "../../components/ui/ContextMenuDivider";
import { IconContextAbrir, IconContextMoverColecao, IconContextRenomear } from "../../components/ui/ContextMenuIcons";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import { ContextMenuSubmenu } from "../../components/ui/ContextMenuSubmenu";
import { HeartIcon, TrashIcon } from "../../components/ui/SharedIcons";
import { useContextMenu } from "../../hooks/useContextMenu";
import type { LibraryCollection } from "../../types/library";

type LibraryItemContextMenuProps = {
  collections: LibraryCollection[];
  contextMenu: ReturnType<typeof useContextMenu>;
  favorite: boolean;
  onOpen: () => void;
  onRename: () => void;
  onToggleFavorite: () => void;
  onMoveToCollection: (collectionId: string) => void;
  onMoveToTrash: () => void;
};

export function LibraryItemContextMenu({
  collections,
  contextMenu,
  favorite,
  onOpen,
  onRename,
  onToggleFavorite,
  onMoveToCollection,
  onMoveToTrash,
}: LibraryItemContextMenuProps) {
  return (
    <ContextMenu isOpen={contextMenu.isOpen} x={contextMenu.x} y={contextMenu.y} onClose={contextMenu.close}>
      <ContextMenuItem
        icon={<IconContextAbrir />}
        label="Abrir"
        onSelect={() => {
          onOpen();
          contextMenu.close();
        }}
      />
      <ContextMenuItem
        icon={<IconContextRenomear />}
        label="Renomear"
        onSelect={() => {
          onRename();
          contextMenu.close();
        }}
      />

      <ContextMenuDivider />

      <ContextMenuItem
        icon={<HeartIcon filled={favorite} size={16} />}
        label={favorite ? "Desfavoritar" : "Favoritar"}
        onSelect={() => {
          onToggleFavorite();
          contextMenu.close();
        }}
      />

      <ContextMenuDivider />

      <ContextMenuSubmenu
        icon={<IconContextMoverColecao />}
        label={"Mover para cole\u00e7\u00e3o"}
        collections={collections}
        onSelect={onMoveToCollection}
        onClose={contextMenu.close}
      />

      <ContextMenuDivider />

      <ContextMenuItem
        icon={<TrashIcon size={16} />}
        label="Mover para lixeira"
        variant="danger"
        onSelect={() => {
          onMoveToTrash();
          contextMenu.close();
        }}
      />
    </ContextMenu>
  );
}
