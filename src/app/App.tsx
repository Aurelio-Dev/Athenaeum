import { LibraryView } from "../features/library/LibraryView";
import { ReaderPanelPopout } from "../features/reader/ReaderPanelPopout";

export function App() {
  if (new URLSearchParams(window.location.search).get("readerPanel") === "1") {
    return <ReaderPanelPopout />;
  }

  return <LibraryView />;
}
