use crate::validate_document_id;
use serde::Serialize;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const READER_PANEL_WINDOW_LABEL: &str = "reader-annotations-panel";
const READER_WINDOW_LABEL: &str = "reader-window";
const READER_SET_DOCUMENT_EVENT: &str = "reader:set-document";
const READER_SWITCH_DOCUMENT_EVENT: &str = "reader-window:switch-document";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReaderDocumentPayload {
    document_id: String,
}

// async de proposito, mesmo remedio do open_notebook_window: no Windows,
// criar WebviewWindow dentro de comando SINCRONO deadlocka o IPC do app
// inteiro (limitacao documentada do tauri, webview_window.rs "Known issues").
#[tauri::command]
pub(crate) async fn open_reader_panel_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    document_id: String,
    document_title: String,
) -> Result<(), String> {
    // O ID atravessa a fronteira IPC e precisa ser validado no Rust antes de
    // entrar na URL, independentemente do tipo declarado no frontend.
    validate_document_id(&document_id)?;

    if let Some(window) = app.get_webview_window(READER_PANEL_WINDOW_LABEL) {
        window
            .set_title(&format!("Anotações — {document_title}"))
            .map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        app.emit_to(
            READER_PANEL_WINDOW_LABEL,
            READER_SET_DOCUMENT_EVENT,
            ReaderDocumentPayload { document_id },
        )
        .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let url = format!("index.html?readerPanel=1&documentId={document_id}");
    WebviewWindowBuilder::new(&app, READER_PANEL_WINDOW_LABEL, WebviewUrl::App(url.into()))
        .title(format!("Anotações — {document_title}"))
        .inner_size(440.0, 640.0)
        .min_inner_size(360.0, 440.0)
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn close_reader_panel_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(READER_PANEL_WINDOW_LABEL) {
        // A popout intercepta CloseRequested para fazer flush. Quando este
        // comando e chamado, o flush ja terminou; destroy evita reemitir o
        // mesmo evento e entrar em recursao.
        window.destroy().map_err(|error| error.to_string())?;
    }

    Ok(())
}

// async de proposito, pelo mesmo motivo dos outros comandos open_*_window:
// criar WebviewWindow num comando sincrono pode bloquear o message loop do
// WebView2 no Windows.
#[tauri::command]
pub(crate) async fn open_reader_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    document_id: String,
    document_title: String,
) -> Result<(), String> {
    validate_document_id(&document_id)?;

    // Label fixo: existe no maximo um Reader nativo. O frontend compara o ID com
    // o documento efetivamente publicado e transforma pedidos redundantes em
    // no-op; o Rust nao antecipa esse estado assincrono.
    if let Some(window) = app.get_webview_window(READER_WINDOW_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        app.emit_to(
            READER_WINDOW_LABEL,
            READER_SWITCH_DOCUMENT_EVENT,
            ReaderDocumentPayload { document_id },
        )
        .map_err(|error| error.to_string())?;
        window
            .set_title(&document_title)
            .map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let url = format!("index.html?readerWindow=1&documentId={document_id}");
    // O painel interno usa ate 1240x900 e tem piso funcional de 720x480. Na
    // janela nativa essas dimensoes sao independentes da viewport da main; o
    // gerenciador de janelas do SO faz o clamp se o monitor for menor.
    WebviewWindowBuilder::new(&app, READER_WINDOW_LABEL, WebviewUrl::App(url.into()))
        .title(document_title)
        .decorations(true)
        .resizable(true)
        .inner_size(1240.0, 900.0)
        .min_inner_size(720.0, 480.0)
        .center()
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn close_reader_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(READER_WINDOW_LABEL) {
        // O frontend intercepta CloseRequested e faz o flush antes de chamar
        // este comando. destroy nao reemite o evento e evita recursao.
        window.destroy().map_err(|error| error.to_string())?;
    }

    Ok(())
}

// async de proposito: no Windows, criar WebviewWindow dentro de comando
// SINCRONO deadlocka (limitacao documentada do proprio tauri, ver
// webview_window.rs "Known issues" — a criacao do WebView2 precisa do message
// loop da main thread, que estaria bloqueada no comando sync).
#[tauri::command]
pub(crate) async fn open_notebook_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    notebook_id: i64,
    notebook_title: String,
) -> Result<(), String> {
    // IDs de caderno sao INTEGER AUTOINCREMENT (> 0). Alem de validar a
    // fronteira IPC, garante que o label e a URL abaixo sao bem-formados.
    if notebook_id <= 0 {
        return Err("Identificador do caderno invalido.".to_string());
    }

    // Um label por caderno: reabrir o mesmo caderno foca a janela existente
    // (nunca duplica); cadernos diferentes coexistem em janelas proprias.
    let label = format!("notebook-{notebook_id}");
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let url = format!("index.html?notebookPanel=1&notebookId={notebook_id}");
    // Tamanho inicial: o layout de 3 colunas do Caderno (paginas | editor |
    // detalhes) foi dimensionado para ~1680x760, e 640x440 e o piso em que ele
    // ainda funciona. O SO clampa ao monitor se a tela for menor.
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(notebook_title)
        .decorations(true)
        .resizable(true)
        .inner_size(1680.0, 760.0)
        .min_inner_size(640.0, 440.0)
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn close_notebook_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    notebook_id: i64,
) -> Result<(), String> {
    // Mesmo racional do close_reader_panel_window: a janela intercepta
    // CloseRequested para fazer flush; quando este comando roda, o flush ja
    // terminou — destroy fecha sem reemitir o evento (sem recursao).
    if let Some(window) = app.get_webview_window(&format!("notebook-{notebook_id}")) {
        window.destroy().map_err(|error| error.to_string())?;
    }

    Ok(())
}
