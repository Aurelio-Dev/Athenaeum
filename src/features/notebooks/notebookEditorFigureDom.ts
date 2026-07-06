type NotebookAssetImageData = {
  id: string;
  mimeType: string;
  dataBase64: string;
};

const notebookAssetImageSelector = "img[data-notebook-asset-id]";

export function removeNotebookAssetImageSources(editor: HTMLElement) {
  editor.querySelectorAll(notebookAssetImageSelector).forEach((image) => {
    image.removeAttribute("src");
  });
}

export function hydrateNotebookAssetImages(editor: HTMLElement, assets: NotebookAssetImageData[]) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  editor.querySelectorAll<HTMLImageElement>(notebookAssetImageSelector).forEach((image) => {
    const assetId = image.dataset.notebookAssetId;
    const asset = assetId ? assetsById.get(assetId) : undefined;

    if (!asset) {
      return;
    }

    image.src = `data:${asset.mimeType};base64,${asset.dataBase64}`;
  });
}
