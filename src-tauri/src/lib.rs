mod canvas;
mod export;
mod migrations;
mod notebook_assets;
mod wallpaper;

use crate::export::NotebookExportDestinations;
use crate::wallpaper::WallpaperImportSources;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Serialize)]
struct SelectedPdfFile {
    file_name: String,
    file_path: String,
    data_base64: String,
}

#[tauri::command]
fn select_pdf_file(
    sources: tauri::State<'_, PdfImportSources>,
) -> Result<Option<SelectedPdfFile>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .pick_file()
    else {
        return Ok(None);
    };

    let canonical_path = canonicalize_pdf_source(&path)?;
    let file_name = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("documento.pdf")
        .to_string();
    let bytes = std::fs::read(&canonical_path).map_err(|error| error.to_string())?;
    sources.authorize(vec![canonical_path.clone()])?;
    let _ = sources.take(&canonical_path, PdfSourceUse::Read)?;

    Ok(Some(SelectedPdfFile {
        file_name,
        file_path: canonical_path.to_string_lossy().to_string(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    }))
}

// Referencia leve a um PDF escolhido: so nome + caminho. Os bytes NAO vem aqui
// (diferente de select_pdf_file) — para um lote grande, embutir base64 de cada
// arquivo seria pesado. Quando os bytes forem necessarios (extrair metadados ou
// pre-visualizar), o frontend le sob demanda via read_pdf_file(caminho).
#[derive(Clone, Serialize)]
struct PickedPdfFile {
    file_name: String,
    file_path: String,
}

#[derive(Clone, Copy, Default)]
struct PdfSourcePermissions {
    can_read: bool,
    can_import: bool,
}

// Origens de PDF autorizadas pelo seletor nativo ou por um drop observado
// diretamente pelo runtime. O WebView recebe o caminho, mas nao e autoridade
// para inclui-lo neste conjunto.
#[derive(Default)]
struct PdfImportSources(std::sync::Mutex<HashMap<PathBuf, PdfSourcePermissions>>);

const MAX_AUTHORIZED_PDF_SOURCES: usize = 512;
const PDF_IMPORT_DROPPED_EVENT: &str = "pdf-import:dropped";

#[derive(Clone, Copy)]
enum PdfSourceUse {
    Read,
    Import,
}

impl PdfImportSources {
    fn authorize(&self, paths: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
        if paths.len() > MAX_AUTHORIZED_PDF_SOURCES {
            return Err(format!(
                "Selecione no maximo {MAX_AUTHORIZED_PDF_SOURCES} PDFs por vez."
            ));
        }

        let mut canonical_paths = Vec::with_capacity(paths.len());
        for path in paths {
            let canonical_path = canonicalize_pdf_source(&path)?;
            if !canonical_paths.contains(&canonical_path) {
                canonical_paths.push(canonical_path);
            }
        }

        let mut authorized = self
            .0
            .lock()
            .map_err(|_| "Estado de importacao de PDF indisponivel.".to_string())?;
        let new_path_count = canonical_paths
            .iter()
            .filter(|path| !authorized.contains_key(*path))
            .count();
        if authorized.len() + new_path_count > MAX_AUTHORIZED_PDF_SOURCES {
            authorized.clear();
        }

        for path in &canonical_paths {
            authorized.insert(
                path.clone(),
                PdfSourcePermissions {
                    can_read: true,
                    can_import: true,
                },
            );
        }

        Ok(canonical_paths)
    }

    fn take(&self, path: &Path, source_use: PdfSourceUse) -> Result<bool, String> {
        let mut authorized = self
            .0
            .lock()
            .map_err(|_| "Estado de importacao de PDF indisponivel.".to_string())?;
        let Some(permissions) = authorized.get_mut(path) else {
            return Ok(false);
        };

        let permission = match source_use {
            PdfSourceUse::Read => &mut permissions.can_read,
            PdfSourceUse::Import => &mut permissions.can_import,
        };
        if !*permission {
            return Ok(false);
        }
        *permission = false;

        if !permissions.can_read && !permissions.can_import {
            authorized.remove(path);
        }

        Ok(true)
    }

    fn restore(&self, path: PathBuf, source_use: PdfSourceUse) {
        if let Ok(mut authorized) = self.0.lock() {
            let permissions = authorized.entry(path).or_default();
            match source_use {
                PdfSourceUse::Read => permissions.can_read = true,
                PdfSourceUse::Import => permissions.can_import = true,
            }
        }
    }

    fn consume(&self, path: &Path) {
        if let Ok(mut authorized) = self.0.lock() {
            authorized.remove(path);
        }
    }
}

fn canonicalize_pdf_source(path: &Path) -> Result<PathBuf, String> {
    let canonical_path = std::fs::canonicalize(path)
        .map_err(|_| "O PDF escolhido nao esta mais disponivel.".to_string())?;
    let is_pdf = canonical_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));

    if !canonical_path.is_file() || !is_pdf {
        return Err("A origem escolhida nao e um arquivo PDF.".to_string());
    }

    Ok(canonical_path)
}

fn managed_pdf_source(managed_pdf_dir: &Path, source: &Path) -> bool {
    let Ok(canonical_managed_dir) = std::fs::canonicalize(managed_pdf_dir) else {
        return false;
    };

    source.parent() == Some(canonical_managed_dir.as_path())
}

fn reserve_pdf_source(
    managed_pdf_dir: &Path,
    sources: &PdfImportSources,
    source: &Path,
    source_use: PdfSourceUse,
) -> Result<(PathBuf, bool), String> {
    // A mesma mensagem cobre inexistencia e falta de autorizacao para nao
    // transformar o comando num oraculo de existencia de arquivos do usuario.
    let canonical_source = canonicalize_pdf_source(source)
        .map_err(|_| "PDF nao autorizado pelo usuario.".to_string())?;
    if managed_pdf_source(managed_pdf_dir, &canonical_source) {
        return Ok((canonical_source, false));
    }

    if !sources.take(&canonical_source, source_use)? {
        return Err("PDF nao autorizado pelo usuario.".to_string());
    }

    Ok((canonical_source, true))
}

struct PdfSourceReservation<'a> {
    sources: &'a PdfImportSources,
    path: PathBuf,
    source_use: PdfSourceUse,
    restore_on_drop: bool,
}

impl<'a> PdfSourceReservation<'a> {
    fn new(
        managed_pdf_dir: &Path,
        sources: &'a PdfImportSources,
        source: &Path,
        source_use: PdfSourceUse,
    ) -> Result<Self, String> {
        let (path, restore_on_drop) =
            reserve_pdf_source(managed_pdf_dir, sources, source, source_use)?;
        Ok(Self {
            sources,
            path,
            source_use,
            restore_on_drop,
        })
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn commit(mut self) {
        if self.restore_on_drop {
            self.sources.consume(&self.path);
            self.restore_on_drop = false;
        }
    }
}

impl Drop for PdfSourceReservation<'_> {
    fn drop(&mut self) {
        if self.restore_on_drop {
            self.sources.restore(self.path.clone(), self.source_use);
        }
    }
}

fn picked_pdf_file(path: PathBuf) -> PickedPdfFile {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("documento.pdf")
        .to_string();

    PickedPdfFile {
        file_name,
        file_path: path.to_string_lossy().to_string(),
    }
}

// Selecao MULTIPLA nativa (um unico dialogo, varios PDFs). Devolve lista vazia
// se o usuario cancelar. Nao substitui select_pdf_file — este e o caminho de
// lote do novo modal de adicionar documentos.
#[tauri::command]
fn select_pdf_files(
    sources: tauri::State<'_, PdfImportSources>,
) -> Result<Vec<PickedPdfFile>, String> {
    let Some(paths) = rfd::FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .pick_files()
    else {
        return Ok(Vec::new());
    };

    Ok(sources
        .authorize(paths)?
        .into_iter()
        .map(picked_pdf_file)
        .collect())
}

#[tauri::command]
fn read_pdf_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    sources: tauri::State<'_, PdfImportSources>,
    file_path: String,
) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
    read_pdf_file_from_path(&data_dir.join("pdfs"), &sources, Path::new(&file_path))
}

fn read_pdf_file_from_path(
    managed_pdf_dir: &Path,
    sources: &PdfImportSources,
    source: &Path,
) -> Result<String, String> {
    let (canonical_source, authorization_reserved) =
        reserve_pdf_source(managed_pdf_dir, sources, source, PdfSourceUse::Read)?;
    match std::fs::read(&canonical_source) {
        Ok(bytes) => Ok(base64::engine::general_purpose::STANDARD.encode(bytes)),
        Err(error) => {
            if authorization_reserved {
                sources.restore(canonical_source, PdfSourceUse::Read);
            }
            Err(format!("Nao foi possivel ler o PDF: {error}"))
        }
    }
}

const READER_PANEL_WINDOW_LABEL: &str = "reader-annotations-panel";
const READER_WINDOW_LABEL: &str = "reader-window";
const READER_SET_DOCUMENT_EVENT: &str = "reader:set-document";
const READER_SWITCH_DOCUMENT_EVENT: &str = "reader-window:switch-document";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReaderDocumentPayload {
    document_id: String,
}

#[cfg(test)]
fn validate_uuid(value: &str, label: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    let has_valid_shape = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        });

    if !has_valid_shape {
        return Err(format!("{label} invalido."));
    }

    Ok(())
}

fn validate_document_id(value: &str) -> Result<(), String> {
    if value.len() > 255 || validate_file_id(value).is_err() {
        return Err("Identificador do documento invalido.".to_string());
    }

    Ok(())
}

// async de proposito, mesmo remedio do open_notebook_window: no Windows,
// criar WebviewWindow dentro de comando SINCRONO deadlocka o IPC do app
// inteiro (limitacao documentada do tauri, webview_window.rs "Known issues").
#[tauri::command]
async fn open_reader_panel_window<R: tauri::Runtime>(
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
fn close_reader_panel_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
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
async fn open_reader_window<R: tauri::Runtime>(
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
fn close_reader_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
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
async fn open_notebook_window<R: tauri::Runtime>(
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
fn close_notebook_window<R: tauri::Runtime>(
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

// ===========================================================================
// import_document — importacao de PDF com transacao REAL.
//
// O resto da persistencia do app roda em TypeScript via plugin-sql: cada acao do
// usuario e 1 statement atomico, o que ja e seguro. A IMPORTACAO e diferente:
// ela grava varias linhas relacionadas (colecao, tags, documento, autores,
// vinculos) que precisam entrar TODAS ou NENHUMA. Isso exige uma transacao numa
// unica conexao (BEGIN...COMMIT) — algo que o pool do plugin-sql, acessado
// statement-a-statement pelo TS, nao garante. Por isso ESTE caso (e so ele) vive
// no Rust. Nao use isso como precedente para mover outras escritas para ca.
//
// Alem do banco, a importacao copia o PDF para o storage do app. O sistema de
// arquivos NAO participa da transacao SQLite, entao a ordem das etapas e o
// tratamento de erro sao explicitos para nunca deixar arquivo orfao (PDF
// copiado, mas sem linha correspondente no banco).
// ===========================================================================

// Tag ja resolvida no TS (id = slug, color_token = tom validado em WCAG AA).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportTag {
    id: String,
    name: String,
    color_token: String,
}

// Tudo o que o comando precisa para gravar o documento. Os ids/tokens ja vem
// resolvidos do TS (slug, tom da tag, id da colecao), entao o Rust so cuida da
// copia do arquivo e da transacao — nao replica regra de negocio.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportDocumentRequest {
    id: String,
    title: String,
    source: String,
    year: i64,
    status: String,
    progress: i64,
    favorite: bool,
    collection_id: String,
    collection_name: String,
    file_name: String,
    // Caminho de ONDE copiar o PDF (arquivo escolhido pelo usuario).
    source_path: String,
    notes: String,
    updated_at: String,
    authors: Vec<String>,
    tags: Vec<ImportTag>,
}

// Mesma string usada no TS em Database.load(...). E a chave do pool no estado.
pub(crate) const DATABASE_KEY: &str = "sqlite:athenaeum.db";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenDocumentExternallyError {
    code: &'static str,
    message: String,
}

impl OpenDocumentExternallyError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

fn map_managed_pdf_io_error(
    error: std::io::Error,
    missing_message: &'static str,
) -> OpenDocumentExternallyError {
    match error.kind() {
        std::io::ErrorKind::NotFound => {
            OpenDocumentExternallyError::new("file_not_found", missing_message)
        }
        std::io::ErrorKind::PermissionDenied => OpenDocumentExternallyError::new(
            "permission_denied",
            "O Athenaeum nao tem permissao para acessar este PDF.",
        ),
        _ => OpenDocumentExternallyError::new(
            "open_failed",
            format!("Nao foi possivel acessar o PDF gerenciado: {error}"),
        ),
    }
}

fn map_opener_error(error: tauri_plugin_opener::Error) -> OpenDocumentExternallyError {
    match error {
        tauri_plugin_opener::Error::Io(io_error) => {
            #[cfg(target_os = "windows")]
            if io_error.raw_os_error() == Some(1155) {
                return OpenDocumentExternallyError::new(
                    "no_associated_application",
                    "Nenhum aplicativo esta associado a arquivos PDF no sistema.",
                );
            }

            match io_error.kind() {
                std::io::ErrorKind::NotFound => OpenDocumentExternallyError::new(
                    "file_not_found",
                    "A copia gerenciada deste PDF nao foi encontrada.",
                ),
                std::io::ErrorKind::PermissionDenied => OpenDocumentExternallyError::new(
                    "permission_denied",
                    "O sistema negou permissao para abrir este PDF.",
                ),
                _ => OpenDocumentExternallyError::new(
                    "open_failed",
                    format!(
                        "Nao foi possivel abrir o PDF. Verifique se ha um visualizador associado: {io_error}"
                    ),
                ),
            }
        }
        other => OpenDocumentExternallyError::new(
            "open_failed",
            format!(
                "Nao foi possivel abrir o PDF. Verifique se ha um visualizador associado: {other}"
            ),
        ),
    }
}

fn validate_document_storage_id(document_id: &str) -> Result<(), OpenDocumentExternallyError> {
    validate_document_id(document_id)
        .map_err(|message| OpenDocumentExternallyError::new("invalid_document_id", message))
}

#[tauri::command]
async fn open_document_externally<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    document_id: String,
) -> Result<(), OpenDocumentExternallyError> {
    validate_document_storage_id(&document_id)?;

    let stored_file_path = {
        let instances = db_instances.0.read().await;
        let pool = match instances.get(DATABASE_KEY) {
            Some(DbPool::Sqlite(pool)) => pool,
            _ => {
                return Err(OpenDocumentExternallyError::new(
                    "database_unavailable",
                    "Banco de dados nao carregado.",
                ));
            }
        };

        let row: Option<(Option<String>,)> =
            sqlx::query_as("SELECT file_path FROM documents WHERE id = ? AND deleted_at IS NULL")
                .bind(&document_id)
                .fetch_optional(pool)
                .await
                .map_err(|error| {
                    OpenDocumentExternallyError::new(
                        "database_error",
                        format!("Nao foi possivel consultar o documento: {error}"),
                    )
                })?;

        match row {
            Some((Some(file_path),)) if !file_path.trim().is_empty() => file_path,
            Some(_) => {
                return Err(OpenDocumentExternallyError::new(
                    "file_not_found",
                    "Este documento nao possui uma copia local gerenciada.",
                ));
            }
            None => {
                return Err(OpenDocumentExternallyError::new(
                    "document_not_found",
                    "Documento nao encontrado.",
                ));
            }
        }
    };

    let data_dir = app.path().app_data_dir().map_err(|error| {
        OpenDocumentExternallyError::new(
            "invalid_managed_path",
            format!("Nao foi possivel localizar o diretorio de dados: {error}"),
        )
    })?;
    let managed_pdf_dir = data_dir.join("pdfs");
    let expected_path = managed_pdf_dir.join(format!("{document_id}.pdf"));
    let stored_path = PathBuf::from(stored_file_path);

    if stored_path.file_name() != expected_path.file_name()
        || stored_path
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("pdf")
    {
        return Err(OpenDocumentExternallyError::new(
            "invalid_managed_path",
            "O caminho registrado nao corresponde a um PDF gerenciado pelo Athenaeum.",
        ));
    }

    let canonical_managed_dir = std::fs::canonicalize(&managed_pdf_dir).map_err(|error| {
        map_managed_pdf_io_error(error, "O diretorio gerenciado de PDFs nao foi encontrado.")
    })?;
    let canonical_stored_path = std::fs::canonicalize(&stored_path).map_err(|error| {
        map_managed_pdf_io_error(error, "A copia gerenciada deste PDF nao foi encontrada.")
    })?;
    let canonical_expected_path = std::fs::canonicalize(&expected_path).map_err(|error| {
        map_managed_pdf_io_error(error, "A copia gerenciada deste PDF nao foi encontrada.")
    })?;

    // A linha do banco nao e autoridade para sair de app_data/pdfs. A
    // canonicalizacao tambem impede escape por symlink ou por componentes `..`.
    if canonical_stored_path != canonical_expected_path
        || !canonical_stored_path.starts_with(&canonical_managed_dir)
    {
        return Err(OpenDocumentExternallyError::new(
            "invalid_managed_path",
            "O PDF solicitado esta fora do diretorio gerenciado pelo Athenaeum.",
        ));
    }

    let metadata = std::fs::metadata(&canonical_stored_path).map_err(|error| {
        map_managed_pdf_io_error(error, "A copia gerenciada deste PDF nao foi encontrada.")
    })?;
    if !metadata.is_file() {
        return Err(OpenDocumentExternallyError::new(
            "invalid_managed_path",
            "O caminho gerenciado nao aponta para um arquivo PDF.",
        ));
    }

    // Testa permissao de leitura sem carregar o PDF inteiro em memoria.
    File::open(&canonical_stored_path).map_err(|error| {
        map_managed_pdf_io_error(error, "A copia gerenciada deste PDF nao foi encontrada.")
    })?;

    tauri_plugin_opener::open_path(&canonical_stored_path, None::<&str>).map_err(map_opener_error)
}

#[tauri::command]
async fn import_document<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    sources: tauri::State<'_, PdfImportSources>,
    request: ImportDocumentRequest,
) -> Result<String, String> {
    validate_document_id(&request.id)?;
    // -------------------------------------------------------------------------
    // ETAPA 1 — Copiar o PDF para o storage do app (operacao de filesystem, FORA
    // da transacao do banco).
    //
    // Por que copiar ANTES de tocar no banco: se a copia falhar, retornamos erro
    // sem ter aberto nenhuma transacao — nao ha nada a reverter. O caminho inverso
    // (gravar a linha e so depois copiar) poderia deixar uma linha no banco
    // apontando para um arquivo que nunca foi criado.
    // -------------------------------------------------------------------------
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
    let pdf_dir = data_dir.join("pdfs");
    std::fs::create_dir_all(&pdf_dir)
        .map_err(|error| format!("Nao foi possivel criar a pasta de PDFs: {error}"))?;
    let source_reservation = PdfSourceReservation::new(
        &pdf_dir,
        &sources,
        Path::new(&request.source_path),
        PdfSourceUse::Import,
    )?;

    // No storage, o arquivo se chama <id>.pdf (o id ja e unico). O nome original
    // de exibicao vai separado, na coluna file_name.
    let dest_path = pdf_dir.join(format!("{}.pdf", request.id));
    let dest_path_str = dest_path.to_string_lossy().into_owned();

    // Se a copia do arquivo falhar, nem tentamos abrir a transacao.
    std::fs::copy(source_reservation.path(), &dest_path)
        .map_err(|error| format!("Nao foi possivel copiar o PDF: {error}"))?;

    // -------------------------------------------------------------------------
    // ETAPA 2 — Gravar tudo numa unica transacao, reaproveitando o MESMO pool do
    // plugin-sql (mesma conexao logica, mesmas PRAGMAs de durabilidade).
    // -------------------------------------------------------------------------
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => {
            // Banco ainda nao carregado: desfaz a copia para nao deixar orfao.
            let _ = std::fs::remove_file(&dest_path);
            return Err("Banco de dados nao carregado.".to_string());
        }
    };

    // Toda a escrita fica neste bloco async que devolve Result. Qualquer `?` aqui
    // dentro encerra o bloco com Err e dropa a `tx` SEM commit (rollback
    // automatico). Caimos entao no `if let Err(...)` abaixo, onde apagamos o
    // arquivo ja copiado. Assim banco e disco ficam sempre coerentes.
    let write_result: Result<(), String> = async {
        let mut tx = pool.begin().await.map_err(|error| error.to_string())?;

        // Colecao: cria se ainda nao existir (o id ja foi resolvido no TS).
        sqlx::query("INSERT OR IGNORE INTO collections (id, name, is_system) VALUES (?, ?, 0)")
            .bind(&request.collection_id)
            .bind(&request.collection_name)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;

        // Tags: upsert mantendo a cor validada.
        for tag in &request.tags {
            sqlx::query(
                "INSERT INTO tags (id, name, color_token) VALUES (?, ?, ?) \
         ON CONFLICT(name) DO UPDATE SET color_token = excluded.color_token",
            )
            .bind(&tag.id)
            .bind(&tag.name)
            .bind(&tag.color_token)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        }

        // Documento. file_path aponta para a COPIA no storage do app (nao para o
        // arquivo original do usuario, que pode ser movido/apagado depois).
        sqlx::query(
            "INSERT INTO documents (\
         id, title, source, year, status, progress, favorite, collection_id, \
         file_name, file_path, notes, reading_location_json, updated_at\
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
        )
        .bind(&request.id)
        .bind(&request.title)
        .bind(&request.source)
        .bind(request.year)
        .bind(&request.status)
        .bind(request.progress)
        .bind(i64::from(request.favorite))
        .bind(&request.collection_id)
        .bind(&request.file_name)
        .bind(&dest_path_str)
        .bind(&request.notes)
        .bind(&request.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;

        // Autores, preservando a ordem.
        for (index, author) in request.authors.iter().enumerate() {
            sqlx::query(
                "INSERT INTO document_authors (document_id, author, author_order) VALUES (?, ?, ?)",
            )
            .bind(&request.id)
            .bind(author)
            .bind(index as i64)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        }

        // Vinculo documento<->tags.
        for (index, tag) in request.tags.iter().enumerate() {
            sqlx::query(
                "INSERT INTO document_tags (document_id, tag_id, tag_order) VALUES (?, ?, ?)",
            )
            .bind(&request.id)
            .bind(&tag.id)
            .bind(index as i64)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        }

        // Confirma tudo de uma vez. Se isto falhar, o `?` propaga e nada e gravado.
        tx.commit().await.map_err(|error| error.to_string())?;
        Ok(())
    }
    .await;

    if let Err(error) = write_result {
        // A transacao foi revertida (tx dropada sem commit), mas o ARQUIVO ja havia
        // sido copiado na Etapa 1. Apagamos para nao sobrar PDF orfao sem linha.
        let _ = std::fs::remove_file(&dest_path);
        return Err(error);
    }

    // Sucesso: devolve o caminho final (storage do app) para o frontend apontar o
    // documento para a copia estavel.
    source_reservation.commit();
    Ok(dest_path_str)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum DocumentFileDeletionOutcome {
    ManagedFileDeleted,
    ManagedFileMissing,
    NoFile,
    UnmanagedFilePreserved,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteDocumentPermanentlyResult {
    outcome: DocumentFileDeletionOutcome,
}

fn remove_managed_document_pdf(
    data_dir: &Path,
    document_id: &str,
    stored_file_path: Option<&str>,
) -> Result<DocumentFileDeletionOutcome, String> {
    let Some(stored_file_path) = stored_file_path.filter(|path| !path.trim().is_empty()) else {
        return Ok(DocumentFileDeletionOutcome::NoFile);
    };
    let managed_pdf_dir = data_dir.join("pdfs");
    let expected_path = managed_pdf_dir.join(format!("{document_id}.pdf"));
    let stored_path = PathBuf::from(stored_file_path);

    // Linhas anteriores a 56330d7 apontam para o arquivo original do usuario.
    // Qualquer divergencia tambem pode ser adulteracao do banco: em ambos os
    // casos, preservar e mais seguro que tentar adivinhar propriedade.
    if stored_path != expected_path {
        return Ok(DocumentFileDeletionOutcome::UnmanagedFilePreserved);
    }
    if !stored_path.exists() {
        return Ok(DocumentFileDeletionOutcome::ManagedFileMissing);
    }

    let canonical_managed_dir = std::fs::canonicalize(&managed_pdf_dir)
        .map_err(|error| format!("Nao foi possivel validar a pasta gerenciada de PDFs: {error}"))?;
    let canonical_stored_path = std::fs::canonicalize(&stored_path)
        .map_err(|error| format!("Nao foi possivel validar o PDF gerenciado: {error}"))?;
    if canonical_stored_path.parent() != Some(canonical_managed_dir.as_path())
        || canonical_stored_path.file_name() != expected_path.file_name()
        || !canonical_stored_path.is_file()
    {
        return Ok(DocumentFileDeletionOutcome::UnmanagedFilePreserved);
    }

    std::fs::remove_file(&canonical_stored_path)
        .map_err(|error| format!("Nao foi possivel remover o PDF gerenciado: {error}"))?;
    Ok(DocumentFileDeletionOutcome::ManagedFileDeleted)
}

#[tauri::command]
async fn delete_document_permanently<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    document_id: String,
) -> Result<DeleteDocumentPermanentlyResult, String> {
    validate_document_id(&document_id)?;
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err("Banco de dados nao carregado.".to_string()),
    };
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT file_path FROM documents WHERE id = ?")
            .bind(&document_id)
            .fetch_optional(pool)
            .await
            .map_err(|error| format!("Nao foi possivel consultar o documento: {error}"))?;
    let Some((stored_file_path,)) = row else {
        return Err("Documento nao encontrado.".to_string());
    };
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
    let outcome =
        remove_managed_document_pdf(&data_dir, &document_id, stored_file_path.as_deref())?;

    sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(&document_id)
        .execute(pool)
        .await
        .map_err(|error| format!("Nao foi possivel excluir o registro do documento: {error}"))?;

    Ok(DeleteDocumentPermanentlyResult { outcome })
}

#[tauri::command]
fn open_file_location(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);

    if !path.exists() {
        return Err("Arquivo nao encontrado.".to_string());
    }

    open_path_in_file_manager(&path)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let normalized_url = url.trim();
    let lower_url = normalized_url.to_ascii_lowercase();

    if normalized_url.is_empty() || normalized_url.chars().any(char::is_control) {
        return Err("URL invalida.".to_string());
    }

    if !lower_url.starts_with("https://")
        && !lower_url.starts_with("http://")
        && !lower_url.starts_with("mailto:")
    {
        return Err("Apenas links http, https e mailto podem ser abertos.".to_string());
    }

    open_url_with_system(normalized_url)
}

#[cfg(target_os = "windows")]
fn open_url_with_system(url: &str) -> Result<(), String> {
    Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn open_url_with_system(url: &str) -> Result<(), String> {
    Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url_with_system(url: &str) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn open_file_with_system(path: &Path) -> Result<(), String> {
    Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn open_file_with_system(path: &Path) -> Result<(), String> {
    Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_file_with_system(path: &Path) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    let target_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut command = Command::new("explorer");

    if target_path.is_dir() {
        command.arg(&target_path);
    } else {
        // Explorer espera `/select,` separado do caminho quando o path precisa de
        // aspas; um unico argumento com tudo junto pode abrir uma pasta incorreta.
        command.arg("/select,").arg(&target_path);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    let folder = path.parent().unwrap_or(path);
    Command::new("xdg-open")
        .arg(folder)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

// O file_id vem do frontend e entra na montagem de um caminho de arquivo.
// Sem esta validacao, um file_id malicioso ou corrompido contendo "../"
// poderia escrever FORA do diretorio do app (path traversal). O fileId real
// do Excalidraw e um hash em [a-zA-Z0-9], entao o filtro nao rejeita nada
// legitimo.
pub(crate) fn validate_file_id(file_id: &str) -> Result<(), String> {
    if file_id.is_empty()
        || !file_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Identificador de arquivo invalido.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_numeric_path_id(value: &str, label: &str) -> Result<i64, String> {
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("{label} invalido."));
    }

    let parsed = value
        .parse::<i64>()
        .map_err(|_| format!("{label} invalido."))?;

    if parsed <= 0 || parsed.to_string() != value {
        return Err(format!("{label} invalido."));
    }

    Ok(parsed)
}

pub(crate) fn sanitize_attachment_file_name(original_name: &str) -> Result<String, String> {
    let trimmed = original_name.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return Err("Nome do arquivo anexado invalido.".to_string());
    }

    let base_name = Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(trimmed);

    let mut sanitized = String::with_capacity(base_name.len().min(180));
    for character in base_name.chars() {
        if character.is_ascii_alphanumeric()
            || matches!(character, '.' | '-' | '_' | ' ' | '(' | ')')
        {
            sanitized.push(character);
        } else if !character.is_control() {
            sanitized.push('_');
        }

        if sanitized.len() >= 180 {
            break;
        }
    }

    let sanitized = sanitized.trim_matches(|character| character == ' ' || character == '.');
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        return Err("Nome do arquivo anexado invalido.".to_string());
    }

    Ok(sanitized.to_string())
}

pub(crate) fn resolve_app_data_relative_path(
    data_dir: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative_path);

    if relative_path.is_absolute() {
        return Err("Caminho de anexo invalido.".to_string());
    }

    for component in relative_path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err("Caminho de anexo invalido.".to_string());
        }
    }

    Ok(data_dir.join(relative_path))
}

// ===========================================================================
// save_notebook_file_attachment / load_notebook_file_attachments — arquivos
// anexados as paginas de Caderno. Primeira fase: sem abrir/revelar/remover.
// ===========================================================================

const MAX_NOTEBOOK_ATTACHMENT_BYTES: usize = 4 * 1024 * 1024;

fn normalize_attachment_display_name(original_name: &str) -> Result<String, String> {
    let trimmed = original_name.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return Err("Nome do arquivo anexado invalido.".to_string());
    }

    let base_name = Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(trimmed)
        .trim();

    if base_name.is_empty()
        || base_name == "."
        || base_name == ".."
        || base_name.chars().any(char::is_control)
    {
        return Err("Nome do arquivo anexado invalido.".to_string());
    }

    Ok(base_name.chars().take(240).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotebookFileAttachmentMetadata {
    id: String,
    notebook_id: i64,
    page_id: i64,
    original_name: String,
    mime_type: Option<String>,
    file_path: String,
    file_size: i64,
    created_at: String,
}

async fn fetch_notebook_file_attachment(
    pool: &sqlx::SqlitePool,
    attachment_id: &str,
) -> Result<NotebookFileAttachmentMetadata, String> {
    // Tupla espelha as colunas do SELECT abaixo. Extrair um type alias
    // aqui separaria a forma do tipo da query que a produz — fica para
    // a decomposicao modular de lib.rs.
    #[allow(clippy::type_complexity)]
    let row: Option<(String, i64, i64, String, Option<String>, String, i64, String)> = sqlx::query_as(
    "SELECT id, notebook_id, page_id, original_name, mime_type, file_path, file_size, created_at \
     FROM notebook_file_attachments WHERE id = ?",
  )
  .bind(attachment_id)
  .fetch_optional(pool)
  .await
  .map_err(|error| format!("Nao foi possivel carregar o anexo do caderno: {error}"))?;

    let Some(row) = row else {
        return Err("Anexo do caderno nao encontrado.".to_string());
    };

    Ok(NotebookFileAttachmentMetadata {
        id: row.0,
        notebook_id: row.1,
        page_id: row.2,
        original_name: row.3,
        mime_type: row.4,
        file_path: row.5,
        file_size: row.6,
        created_at: row.7,
    })
}

async fn get_notebook_file_attachment_with_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db_instances: &tauri::State<'_, DbInstances>,
    attachment_id: &str,
) -> Result<(NotebookFileAttachmentMetadata, PathBuf), String> {
    validate_file_id(attachment_id)?;

    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err("Banco de dados nao carregado.".to_string()),
    };

    let attachment = fetch_notebook_file_attachment(pool, attachment_id).await?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
    let absolute_path = resolve_app_data_relative_path(&data_dir, &attachment.file_path)?;

    Ok((attachment, absolute_path))
}

#[tauri::command]
// Comando Tauri recebe app handle, estado do banco e os campos do
// asset como parametros separados. Reduzir a lista exigiria um
// struct de entrada, o que muda o contrato IPC — fica para a
// decomposicao modular de lib.rs.
#[allow(clippy::too_many_arguments)]
async fn save_notebook_file_attachment<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    notebook_id: String,
    page_id: String,
    attachment_id: String,
    original_name: String,
    mime_type: Option<String>,
    data_base64: String,
) -> Result<NotebookFileAttachmentMetadata, String> {
    // Validacoes antes de qualquer escrita no disco.
    let notebook_id_number = validate_numeric_path_id(&notebook_id, "Identificador do caderno")?;
    let page_id_number = validate_numeric_path_id(&page_id, "Identificador da pagina")?;
    validate_file_id(&attachment_id)?;
    let display_name = normalize_attachment_display_name(&original_name)?;
    let sanitized_name = sanitize_attachment_file_name(&display_name)?;
    let normalized_mime_type = mime_type
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && !value.chars().any(char::is_control));

    if data_base64.len() > (MAX_NOTEBOOK_ATTACHMENT_BYTES / 3 + 1) * 4 {
        return Err(format!(
            "Arquivo anexado excede o limite de {}MB.",
            MAX_NOTEBOOK_ATTACHMENT_BYTES / 1024 / 1024
        ));
    }

    let data = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|error| format!("Base64 invalido: {error}"))?;

    if data.len() > MAX_NOTEBOOK_ATTACHMENT_BYTES {
        return Err(format!(
            "Arquivo anexado excede o limite de {}MB.",
            MAX_NOTEBOOK_ATTACHMENT_BYTES / 1024 / 1024
        ));
    }

    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err("Banco de dados nao carregado.".to_string()),
    };

    let page_owner: Option<(i64,)> =
        sqlx::query_as("SELECT notebook_id FROM notebook_pages WHERE id = ?")
            .bind(page_id_number)
            .fetch_optional(pool)
            .await
            .map_err(|error| format!("Nao foi possivel validar a pagina do caderno: {error}"))?;

    match page_owner {
        Some((owner_notebook_id,)) if owner_notebook_id == notebook_id_number => {}
        Some(_) => return Err("A pagina informada nao pertence ao caderno informado.".to_string()),
        None => return Err("Pagina do caderno nao encontrada.".to_string()),
    }

    let existing_attachment: Option<(i64, i64)> =
        sqlx::query_as("SELECT notebook_id, page_id FROM notebook_file_attachments WHERE id = ?")
            .bind(&attachment_id)
            .fetch_optional(pool)
            .await
            .map_err(|error| format!("Nao foi possivel verificar o anexo do caderno: {error}"))?;

    if let Some((existing_notebook_id, existing_page_id)) = existing_attachment {
        if existing_notebook_id != notebook_id_number || existing_page_id != page_id_number {
            return Err("Identificador de anexo ja esta em uso por outra pagina.".to_string());
        }
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
    let relative_path =
        format!("notebook-attachments/{notebook_id}/{page_id}/{attachment_id}/{sanitized_name}");
    let final_path = data_dir
        .join("notebook-attachments")
        .join(&notebook_id)
        .join(&page_id)
        .join(&attachment_id)
        .join(&sanitized_name);

    if final_path.exists() {
        let existing_size = std::fs::metadata(&final_path)
            .map_err(|error| format!("Nao foi possivel inspecionar o anexo existente: {error}"))?
            .len();

        if existing_size != data.len() as u64 {
            return Err("Anexo do caderno ja existe em disco com tamanho diferente.".to_string());
        }
    } else {
        if let Some(parent) = final_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("Nao foi possivel criar a pasta de anexos do caderno: {error}")
            })?;
        }

        let temp_path = final_path.with_file_name(format!("{sanitized_name}.tmp"));

        std::fs::write(&temp_path, &data)
            .map_err(|error| format!("Nao foi possivel gravar o anexo do caderno: {error}"))?;

        if let Err(error) = std::fs::rename(&temp_path, &final_path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "Nao foi possivel finalizar o anexo do caderno: {error}"
            ));
        }
    }

    sqlx::query(
        "INSERT INTO notebook_file_attachments \
       (id, notebook_id, page_id, original_name, mime_type, file_path, file_size) \
     VALUES (?, ?, ?, ?, ?, ?, ?) \
     ON CONFLICT (id) DO UPDATE SET \
       notebook_id = excluded.notebook_id, \
       page_id = excluded.page_id, \
       original_name = excluded.original_name, \
       mime_type = excluded.mime_type, \
       file_path = excluded.file_path, \
       file_size = excluded.file_size",
    )
    .bind(&attachment_id)
    .bind(notebook_id_number)
    .bind(page_id_number)
    .bind(&display_name)
    .bind(&normalized_mime_type)
    .bind(&relative_path)
    .bind(data.len() as i64)
    .execute(pool)
    .await
    .map_err(|error| format!("Nao foi possivel registrar o anexo do caderno: {error}"))?;

    let row: (String, i64, i64, String, Option<String>, String, i64, String) = sqlx::query_as(
    "SELECT id, notebook_id, page_id, original_name, mime_type, file_path, file_size, created_at \
     FROM notebook_file_attachments WHERE id = ?",
  )
  .bind(&attachment_id)
  .fetch_one(pool)
  .await
  .map_err(|error| format!("Nao foi possivel carregar o anexo salvo do caderno: {error}"))?;

    Ok(NotebookFileAttachmentMetadata {
        id: row.0,
        notebook_id: row.1,
        page_id: row.2,
        original_name: row.3,
        mime_type: row.4,
        file_path: row.5,
        file_size: row.6,
        created_at: row.7,
    })
}

#[tauri::command]
async fn open_notebook_file_attachment<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    attachment_id: String,
) -> Result<(), String> {
    let (_attachment, absolute_path) =
        get_notebook_file_attachment_with_path(&app, &db_instances, &attachment_id).await?;

    if !absolute_path.is_file() {
        return Err("Arquivo anexado nao encontrado no disco.".to_string());
    }

    open_file_with_system(&absolute_path)
        .map_err(|error| format!("Nao foi possivel abrir o arquivo anexado: {error}"))
}

#[tauri::command]
async fn reveal_notebook_file_attachment<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    attachment_id: String,
) -> Result<(), String> {
    let (_attachment, absolute_path) =
        get_notebook_file_attachment_with_path(&app, &db_instances, &attachment_id).await?;

    if !absolute_path.exists() {
        return Err("Arquivo anexado nao encontrado no disco.".to_string());
    }

    open_path_in_file_manager(&absolute_path)
        .map_err(|error| format!("Nao foi possivel mostrar o arquivo anexado: {error}"))
}

#[tauri::command]
async fn delete_notebook_file_attachment<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    attachment_id: String,
) -> Result<NotebookFileAttachmentMetadata, String> {
    let (attachment, absolute_path) =
        get_notebook_file_attachment_with_path(&app, &db_instances, &attachment_id).await?;

    if absolute_path.exists() {
        std::fs::remove_file(&absolute_path)
            .map_err(|error| format!("Nao foi possivel remover o arquivo anexado: {error}"))?;
    }

    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err("Banco de dados nao carregado.".to_string()),
    };

    sqlx::query("DELETE FROM notebook_file_attachments WHERE id = ?")
        .bind(&attachment.id)
        .execute(pool)
        .await
        .map_err(|error| format!("Nao foi possivel remover o registro do anexo: {error}"))?;

    if let Some(attachment_dir) = absolute_path.parent() {
        let _ = std::fs::remove_dir(attachment_dir);
        if let Some(page_dir) = attachment_dir.parent() {
            let _ = std::fs::remove_dir(page_dir);
            if let Some(notebook_dir) = page_dir.parent() {
                let _ = std::fs::remove_dir(notebook_dir);
            }
        }
    }

    Ok(attachment)
}

#[tauri::command]
async fn load_notebook_file_attachments(
    db_instances: tauri::State<'_, DbInstances>,
    page_id: String,
) -> Result<Vec<NotebookFileAttachmentMetadata>, String> {
    let page_id_number = validate_numeric_path_id(&page_id, "Identificador da pagina")?;

    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err("Banco de dados nao carregado.".to_string()),
    };

    // Tupla espelha as colunas do SELECT abaixo. Extrair um type alias
    // aqui separaria a forma do tipo da query que a produz — fica para
    // a decomposicao modular de lib.rs.
    #[allow(clippy::type_complexity)]
    let rows: Vec<(String, i64, i64, String, Option<String>, String, i64, String)> = sqlx::query_as(
    "SELECT id, notebook_id, page_id, original_name, mime_type, file_path, file_size, created_at \
     FROM notebook_file_attachments WHERE page_id = ? ORDER BY created_at ASC, id ASC",
  )
  .bind(page_id_number)
  .fetch_all(pool)
  .await
  .map_err(|error| format!("Nao foi possivel listar os anexos do caderno: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| NotebookFileAttachmentMetadata {
            id: row.0,
            notebook_id: row.1,
            page_id: row.2,
            original_name: row.3,
            mime_type: row.4,
            file_path: row.5,
            file_size: row.6,
            created_at: row.7,
        })
        .collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // PDFs autorizados pelo seletor ou pelo evento nativo de arraste.
        .manage(PdfImportSources::default())
        // Destinos de exportacao autorizados pelo dialogo nativo nesta sessao.
        .manage(NotebookExportDestinations::default())
        // Imagens autorizadas pelo dialogo nativo para virar wallpaper.
        .manage(WallpaperImportSources::default())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:athenaeum.db", migrations::database_migrations())
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_webview_event(|webview, event| {
            if webview.label() != "main" {
                return;
            }

            let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event
            else {
                return;
            };
            let pdf_paths = paths
                .iter()
                .filter(|path| {
                    path.extension()
                        .and_then(|extension| extension.to_str())
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
                })
                .cloned()
                .collect::<Vec<_>>();
            if pdf_paths.is_empty() {
                return;
            }

            let sources = webview.state::<PdfImportSources>();
            match sources.authorize(pdf_paths) {
                Ok(paths) => {
                    let files = paths.into_iter().map(picked_pdf_file).collect::<Vec<_>>();
                    if let Err(error) = webview.emit(PDF_IMPORT_DROPPED_EVENT, files) {
                        eprintln!("Nao foi possivel entregar os PDFs arrastados: {error}");
                    }
                }
                Err(error) => eprintln!("PDF arrastado recusado: {error}"),
            }
        })
        .invoke_handler(tauri::generate_handler![
            close_notebook_window,
            close_reader_panel_window,
            close_reader_window,
            delete_document_permanently,
            import_document,
            wallpaper::import_wallpaper,
            delete_notebook_file_attachment,
            canvas::load_canvas_files,
            notebook_assets::load_notebook_assets,
            load_notebook_file_attachments,
            open_document_externally,
            open_external_url,
            open_file_location,
            open_notebook_file_attachment,
            open_notebook_window,
            open_reader_panel_window,
            open_reader_window,
            read_pdf_file,
            wallpaper::remove_wallpaper,
            wallpaper::resolve_wallpaper_path,
            reveal_notebook_file_attachment,
            canvas::save_canvas_file,
            notebook_assets::save_notebook_asset,
            save_notebook_file_attachment,
            export::select_notebook_export_destination,
            select_pdf_file,
            select_pdf_files,
            wallpaper::select_wallpaper_image,
            export::write_notebook_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_canonical_uuid_shape() {
        assert!(validate_uuid("550e8400-e29b-41d4-a716-446655440000", "Identificador").is_ok());
        assert!(validate_uuid("550e8400e29b41d4a716446655440000", "Identificador").is_err());
        assert!(validate_uuid("550e8400-e29b-41d4-a716-44665544000z", "Identificador").is_err());
    }

    #[test]
    fn accepts_document_ids_generated_by_the_import_flow() {
        assert!(validate_document_storage_id(
            "lista-circular-550e8400-e29b-41d4-a716-446655440000"
        )
        .is_ok());
        assert!(validate_document_storage_id("../documento").is_err());
        assert!(validate_document_storage_id(&"a".repeat(256)).is_err());
    }

    fn pdf_authorization_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "athenaeum-pdf-authorization-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("criar diretorio de teste");
        dir
    }

    #[test]
    fn refuses_an_unauthorized_external_pdf_read() {
        let dir = pdf_authorization_test_dir("unauthorized-read");
        let managed_dir = dir.join("pdfs");
        std::fs::create_dir_all(&managed_dir).unwrap();
        let source = dir.join("externo.pdf");
        std::fs::write(&source, b"%PDF-1.4 externo").unwrap();

        let error = read_pdf_file_from_path(&managed_dir, &PdfImportSources::default(), &source)
            .expect_err("caminho externo sem origem confiavel deve ser recusado");

        assert!(error.contains("nao autorizado"), "mensagem: {error}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_an_authorized_pdf_once_and_keeps_its_import_slot() {
        let dir = pdf_authorization_test_dir("authorized-read");
        let managed_dir = dir.join("pdfs");
        std::fs::create_dir_all(&managed_dir).unwrap();
        let source = dir.join("externo.pdf");
        let bytes = b"%PDF-1.4 autorizado";
        std::fs::write(&source, bytes).unwrap();
        let sources = PdfImportSources::default();
        let canonical_source = sources
            .authorize(vec![source.clone()])
            .expect("autorizar selecao")
            .remove(0);

        let encoded = read_pdf_file_from_path(&managed_dir, &sources, &source)
            .expect("primeira leitura autorizada");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap(),
            bytes
        );
        assert!(read_pdf_file_from_path(&managed_dir, &sources, &source).is_err());

        let import_reservation =
            PdfSourceReservation::new(&managed_dir, &sources, &source, PdfSourceUse::Import)
                .expect("slot de importacao continua autorizado");
        import_reservation.commit();
        assert!(PdfSourceReservation::new(
            &managed_dir,
            &sources,
            &canonical_source,
            PdfSourceUse::Import,
        )
        .is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn managed_pdfs_are_always_readable_without_session_authorization() {
        let dir = pdf_authorization_test_dir("managed-read");
        let managed_dir = dir.join("pdfs");
        std::fs::create_dir_all(&managed_dir).unwrap();
        let source = managed_dir.join("documento.pdf");
        std::fs::write(&source, b"%PDF-1.4 gerenciado").unwrap();
        let sources = PdfImportSources::default();

        assert!(read_pdf_file_from_path(&managed_dir, &sources, &source).is_ok());
        assert!(read_pdf_file_from_path(&managed_dir, &sources, &source).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deletes_only_the_exact_managed_document_pdf() {
        let dir = pdf_authorization_test_dir("managed-delete");
        let managed_dir = dir.join("pdfs");
        std::fs::create_dir_all(&managed_dir).unwrap();
        let document_id = "documento-550e8400-e29b-41d4-a716-446655440000";
        let managed_file = managed_dir.join(format!("{document_id}.pdf"));
        std::fs::write(&managed_file, b"%PDF-1.4 gerenciado").unwrap();

        let outcome = remove_managed_document_pdf(
            &dir,
            document_id,
            Some(managed_file.to_string_lossy().as_ref()),
        )
        .expect("remover copia gerenciada");

        assert_eq!(outcome, DocumentFileDeletionOutcome::ManagedFileDeleted);
        assert!(!managed_file.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_a_legacy_pdf_outside_the_managed_directory() {
        let dir = pdf_authorization_test_dir("legacy-delete");
        let managed_dir = dir.join("pdfs");
        std::fs::create_dir_all(&managed_dir).unwrap();
        let legacy_file = dir.join("original-do-usuario.pdf");
        std::fs::write(&legacy_file, b"%PDF-1.4 original").unwrap();

        let outcome = remove_managed_document_pdf(
            &dir,
            "documento-550e8400-e29b-41d4-a716-446655440000",
            Some(legacy_file.to_string_lossy().as_ref()),
        )
        .expect("classificar referencia legada");

        assert_eq!(outcome, DocumentFileDeletionOutcome::UnmanagedFilePreserved);
        assert!(
            legacy_file.exists(),
            "o arquivo original nunca pode ser apagado"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
