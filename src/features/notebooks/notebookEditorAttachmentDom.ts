import { isFileAttachmentAction, type FileAttachmentAction } from "./notebookEditorUtils";

export type FileAttachmentActionTarget = {
  action: FileAttachmentAction;
  attachmentBlock: HTMLElement;
  attachmentId: string;
};

export function fileAttachmentActionsHtml() {
  return `
    <div data-file-attachment-actions="true" contenteditable="false">
      <button type="button" data-file-attachment-action="open">Abrir</button>
      <button type="button" data-file-attachment-action="reveal">Mostrar no sistema</button>
      <button type="button" data-file-attachment-action="delete">Remover</button>
    </div>
  `;
}

export function normalizeFileAttachmentCards(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>('[data-athenaeum-block="file-attachment"]').forEach((attachment) => {
    let card = attachment.querySelector<HTMLElement>(':scope > [data-file-attachment-card="true"]');

    if (!card) {
      card = document.createElement("div");
      card.dataset.fileAttachmentCard = "true";
      card.contentEditable = "false";
      attachment.prepend(card);
    }

    card.contentEditable = "false";
    card.setAttribute("contenteditable", "false");

    if (!card.querySelector('[data-file-attachment-actions="true"]')) {
      card.insertAdjacentHTML("beforeend", fileAttachmentActionsHtml());
    }
  });
}

export function clearFileAttachmentControls(editor: HTMLElement) {
  editor.querySelectorAll('[data-file-attachment-actions="true"]').forEach((actions) => {
    actions.remove();
  });
}

export function findFileAttachmentActionFromTarget(
  editor: HTMLElement | null,
  target: EventTarget | null,
): FileAttachmentActionTarget | null {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const actionElement = element?.closest("[data-file-attachment-action]");

  if (!editor || !(actionElement instanceof HTMLElement) || !editor.contains(actionElement)) {
    return null;
  }

  const action = actionElement.dataset.fileAttachmentAction;
  if (!isFileAttachmentAction(action)) {
    return null;
  }

  const attachmentBlock = actionElement.closest('[data-athenaeum-block="file-attachment"]');
  if (!(attachmentBlock instanceof HTMLElement) || !editor.contains(attachmentBlock)) {
    return null;
  }

  const attachmentId = attachmentBlock.dataset.notebookAttachmentId;
  if (!attachmentId) {
    return null;
  }

  return { action, attachmentBlock, attachmentId };
}
