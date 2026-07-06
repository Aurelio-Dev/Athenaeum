import { calloutIcons, isCalloutType, type CalloutType } from "./notebookEditorUtils";

export function findClosestCallout(node: Node | null, editor: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const callout = element?.closest('[data-athenaeum-block="callout"]');

  return callout instanceof HTMLElement && editor.contains(callout) ? callout : null;
}

export function getCalloutType(callout: HTMLElement): CalloutType {
  return isCalloutType(callout.dataset.calloutType) ? callout.dataset.calloutType : "info";
}

export function setCalloutType(callout: HTMLElement, type: CalloutType) {
  callout.dataset.calloutType = type;

  const icon = callout.querySelector<HTMLElement>('[data-callout-icon="true"]');
  if (icon) {
    icon.textContent = calloutIcons[type];
  }
}

export function normalizeCallouts(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>('[data-athenaeum-block="callout"]').forEach((callout) => {
    const type = getCalloutType(callout);
    callout.dataset.calloutType = type;

    let icon = callout.querySelector<HTMLElement>(':scope > [data-callout-icon="true"]');
    if (!icon) {
      icon = document.createElement("div");
      icon.dataset.calloutIcon = "true";
      callout.prepend(icon);
    }
    icon.textContent = calloutIcons[type];

    let content = callout.querySelector<HTMLElement>(':scope > [data-callout-content="true"]');
    if (!content) {
      const nextContent = document.createElement("div");
      nextContent.dataset.calloutContent = "true";

      Array.from(callout.childNodes).forEach((child) => {
        if (child !== icon) {
          nextContent.appendChild(child);
        }
      });

      callout.appendChild(nextContent);
      content = nextContent;
    }

    if (content.childNodes.length === 0) {
      content.appendChild(document.createElement("br"));
    }
  });
}
