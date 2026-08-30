use base64::write::EncoderWriter;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

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

// Destinos de exportacao AUTORIZADOS pelo usuario via dialogo nativo nesta
// sessao. write_notebook_export so grava em um caminho presente aqui: o
// WebView nao consegue inventar um destino — todo caminho de escrita passou
// por uma escolha explicita do usuario no dialogo de salvar.
#[derive(Default)]
struct NotebookExportDestinations(std::sync::Mutex<HashSet<PathBuf>>);

// Teto do conjunto de autorizacoes: no fluxo normal ha no maximo um destino
// pendente por vez (dialogo -> preparar -> gravar, que consome). Destinos
// abandonados (dialogo aberto e nunca gravado, ou "Trocar destino") nao devem
// se acumular numa sessao longa. Ao estourar, limpamos os obsoletos antes de
// registrar o novo — a escolha atual sempre sobrevive.
const MAX_AUTHORIZED_EXPORT_DESTINATIONS: usize = 32;

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

#[tauri::command]
fn select_notebook_export_destination(
    destinations: tauri::State<'_, NotebookExportDestinations>,
    default_file_name: String,
) -> Result<Option<String>, String> {
    let fallback_file_name = "caderno.html";
    let trimmed_file_name = default_file_name.trim();
    let file_name = if trimmed_file_name.is_empty() {
        fallback_file_name
    } else {
        trimmed_file_name
    };

    let Some(path) = rfd::FileDialog::new()
        .add_filter("HTML", &["html", "htm"])
        .set_file_name(file_name)
        .save_file()
    else {
        return Ok(None);
    };

    // So autoriza destino bem-formado (.html/.htm absoluto): o conjunto
    // autorizado nunca guarda um caminho que a escrita rejeitaria depois, e o
    // usuario recebe o erro ja na selecao em vez de so ao clicar em Exportar.
    validate_export_destination_shape(&path)?;

    // Registra a escolha do usuario; a comparacao na escrita e pelo PathBuf
    // exato que devolvemos ao frontend (ida e volta literal, sem normalizacao).
    let mut authorized = destinations
        .0
        .lock()
        .map_err(|_| "Estado de exportacao indisponivel.".to_string())?;
    if authorized.len() >= MAX_AUTHORIZED_EXPORT_DESTINATIONS {
        authorized.clear();
    }
    authorized.insert(path.clone());
    drop(authorized);

    Ok(Some(path.to_string_lossy().to_string()))
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
const DATABASE_KEY: &str = "sqlite:athenaeum.db";

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

// ===========================================================================
// save_canvas_file / load_canvas_files — binarios (imagens) dos Quadros.
//
// Por que comandos Rust dedicados, e nao TypeScript via plugin-sql: a
// operacao tem DUAS metades que precisam ficar coerentes — o arquivo em
// disco e a linha em canvas_files — e nao existe transacao que cubra os
// dois sistemas ao mesmo tempo. A coerencia vem da ORDEM das etapas e do
// tratamento de erro explicito (mesmo motivo pelo qual import_document
// foge do padrao TypeScript).
// ===========================================================================

// Limite de tamanho por arquivo: 4MB. Validado no BACKEND porque o backend
// e a ultima linha de defesa — a validacao do frontend e cortesia de UX,
// nao seguranca (qualquer chamada de invoke chega aqui direto).
//
// O valor ESPELHA de proposito o MAX_ALLOWED_FILE_BYTES (4 * 1024 * 1024) do
// Excalidraw: a lib ja reduz a imagem para 1440px e rejeita acima de 4MB
// ANTES de chamar este comando, entao pela via normal da UI nada entre 4MB e
// o antigo limite de 10MB chegava aqui. Alinhar os dois numeros garante que,
// se algum caminho futuro (mudanca da lib, invoke manual) entregar um arquivo
// grande direto ao backend, ele seja rejeitado no MESMO patamar que a UI
// anuncia — uma unica fonte de verdade, sem duas mensagens de erro diferentes
// para o mesmo problema.
const MAX_CANVAS_FILE_BYTES: usize = 4 * 1024 * 1024;
const MAX_NOTEBOOK_ASSET_BYTES: usize = 4 * 1024 * 1024;
const MAX_NOTEBOOK_ATTACHMENT_BYTES: usize = 4 * 1024 * 1024;

// Traduz o mime type do Excalidraw para a extensao do arquivo em disco.
// Lista fechada de proposito: mime desconhecido e rejeitado com erro claro
// em vez de gravado com extensao "chutada" (um arquivo com extensao errada
// e um bug latente dificil de rastrear depois).
fn mime_to_extension(mime_type: &str) -> Result<&'static str, String> {
    match mime_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/gif" => Ok("gif"),
        "image/svg+xml" => Ok("svg"),
        "image/webp" => Ok("webp"),
        other => Err(format!("Tipo de arquivo nao suportado no quadro: {other}")),
    }
}

fn notebook_asset_mime_to_extension(mime_type: &str) -> Result<&'static str, String> {
    match mime_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/gif" => Ok("gif"),
        "image/webp" => Ok("webp"),
        "image/svg+xml" => Err("SVG ainda nao e suportado em assets de caderno.".to_string()),
        other => Err(format!("Tipo de arquivo nao suportado no caderno: {other}")),
    }
}

// O file_id vem do frontend e entra na montagem de um caminho de arquivo.
// Sem esta validacao, um file_id malicioso ou corrompido contendo "../"
// poderia escrever FORA do diretorio do app (path traversal). O fileId real
// do Excalidraw e um hash em [a-zA-Z0-9], entao o filtro nao rejeita nada
// legitimo.
fn validate_file_id(file_id: &str) -> Result<(), String> {
    if file_id.is_empty()
        || !file_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Identificador de arquivo invalido.".to_string());
    }
    Ok(())
}

fn validate_numeric_path_id(value: &str, label: &str) -> Result<i64, String> {
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

fn sanitize_attachment_file_name(original_name: &str) -> Result<String, String> {
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

fn resolve_app_data_relative_path(data_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
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

#[tauri::command]
async fn save_canvas_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    canvas_id: i64,
    file_id: String,
    mime_type: String,
    data_base64: String,
) -> Result<String, String> {
    // ---------------------------------------------------------------------
    // ETAPA 1 — Validacoes ANTES de tocar no disco.
    //
    // Os bytes chegam como base64 (e nao Vec<u8>) de proposito: o IPC do
    // Tauri serializa argumentos como JSON, e um Vec<u8> de 4MB viraria um
    // array JSON de 4 milhoes de numeros — lento de serializar e parsear.
    // O Excalidraw ja entrega a imagem como dataURL base64, entao o TS so
    // recorta o prefixo e repassa a string; o Rust decodifica uma vez aqui.
    //
    // Checagem em dois tempos: primeiro o tamanho da STRING codificada
    // (base64 ocupa ~4/3 do binario — da para rejeitar um payload de 100MB
    // sem gastar CPU decodificando), depois o tamanho exato dos bytes.
    // ---------------------------------------------------------------------
    validate_file_id(&file_id)?;
    let extension = mime_to_extension(&mime_type)?;

    if data_base64.len() > (MAX_CANVAS_FILE_BYTES / 3 + 1) * 4 {
        // Mensagem derivada da constante: se o limite mudar, o texto acompanha
        // sozinho (uma fonte de verdade, sem "10MB" hardcoded desatualizando).
        return Err(format!(
            "Arquivo excede o limite de {}MB.",
            MAX_CANVAS_FILE_BYTES / 1024 / 1024
        ));
    }

    let data = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|error| format!("Base64 invalido: {error}"))?;

    if data.len() > MAX_CANVAS_FILE_BYTES {
        // Mensagem derivada da constante: se o limite mudar, o texto acompanha
        // sozinho (uma fonte de verdade, sem "10MB" hardcoded desatualizando).
        return Err(format!(
            "Arquivo excede o limite de {}MB.",
            MAX_CANVAS_FILE_BYTES / 1024 / 1024
        ));
    }

    // ---------------------------------------------------------------------
    // ETAPA 2 — Montar os caminhos.
    //
    // No banco fica o caminho RELATIVO (com "/", estavel entre plataformas);
    // o caminho absoluto e resolvido em runtime a partir do app_data_dir —
    // assim o banco continua valido se o usuario mover a pasta do app.
    // ---------------------------------------------------------------------
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
    let relative_path = format!("canvas-assets/{canvas_id}/{file_id}.{extension}");
    let final_path = data_dir
        .join("canvas-assets")
        .join(canvas_id.to_string())
        .join(format!("{file_id}.{extension}"));

    // ---------------------------------------------------------------------
    // ETAPA 3 — Se o arquivo final JA existe, pular a escrita.
    //
    // O file_id e um hash do CONTEUDO: arquivo existente com esse nome tem,
    // por construcao, os mesmos bytes. Alem de evitar trabalho, isso resolve
    // um detalhe do Windows: std::fs::rename falha quando o destino existe
    // (diferente do POSIX, que sobrescreve). O INSERT da etapa 6 ainda roda:
    // se uma execucao anterior morreu ENTRE o rename e o insert (arquivo
    // orfao em disco), o re-save "cura" o orfao criando a linha que faltou.
    // ---------------------------------------------------------------------
    if !final_path.exists() {
        // -------------------------------------------------------------------
        // ETAPA 4 — Garantir o diretorio de destino.
        // -------------------------------------------------------------------
        if let Some(parent) = final_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("Nao foi possivel criar a pasta de arquivos do quadro: {error}")
            })?;
        }

        // -------------------------------------------------------------------
        // ETAPA 5 — ESCRITA ATOMICA: temporario + rename.
        //
        // Este e o ponto mais importante da funcao. Se o processo morrer no
        // meio de um write direto no arquivo final, ele fica parcialmente
        // escrito mas "existindo" — o pior cenario possivel, porque parece
        // valido mas esta corrompido (e a etapa 3 passaria a pular a escrita
        // para sempre!). Com temp+rename, ou a escrita completa 100% e o
        // rename acontece, ou nada muda: rename() e atomico no nivel do SO
        // dentro do mesmo filesystem (por isso o .tmp mora no MESMO diretorio
        // do destino — rename entre filesystems deixaria de ser atomico).
        // -------------------------------------------------------------------
        let temp_path = final_path.with_extension(format!("{extension}.tmp"));

        std::fs::write(&temp_path, &data)
            .map_err(|error| format!("Nao foi possivel gravar o arquivo do quadro: {error}"))?;

        if let Err(error) = std::fs::rename(&temp_path, &final_path) {
            // Best effort: nao deixar o .tmp para tras. Se o remove tambem
            // falhar, e so lixo inofensivo — nunca um arquivo final corrompido.
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "Nao foi possivel finalizar o arquivo do quadro: {error}"
            ));
        }
    }

    // ---------------------------------------------------------------------
    // ETAPA 6 — Registrar no banco SOMENTE depois do arquivo estar integro
    // em disco.
    //
    // A ordem importa: se o insert falhar agora, sobra um arquivo orfao em
    // disco (lixo inofensivo, curavel no proximo save — ver etapa 3). A
    // ordem inversa poderia deixar uma linha apontando para um arquivo que
    // nao existe: quadro quebrado ao carregar, sem pista do motivo.
    //
    // ON CONFLICT DO NOTHING casa com o UNIQUE (canvas_id, file_id) da v12:
    // re-salvar a mesma imagem e idempotente.
    // ---------------------------------------------------------------------
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err("Banco de dados nao carregado.".to_string()),
    };

    sqlx::query(
        "INSERT INTO canvas_files (canvas_id, file_id, mime_type, file_path) VALUES (?, ?, ?, ?) \
     ON CONFLICT (canvas_id, file_id) DO NOTHING",
    )
    .bind(canvas_id)
    .bind(&file_id)
    .bind(&mime_type)
    .bind(&relative_path)
    .execute(pool)
    .await
    .map_err(|error| format!("Nao foi possivel registrar o arquivo do quadro: {error}"))?;

    // Devolve o caminho relativo para o TS confirmar o sucesso.
    Ok(relative_path)
}

// Um arquivo do quadro pronto para o frontend: base64 para o TS reconstruir
// o dataURL que o Excalidraw espera em `files`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasFileData {
    file_id: String,
    mime_type: String,
    data_base64: String,
}

#[tauri::command]
async fn load_canvas_files<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    canvas_id: i64,
) -> Result<Vec<CanvasFileData>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;

    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err("Banco de dados nao carregado.".to_string()),
    };

    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT file_id, mime_type, file_path FROM canvas_files WHERE canvas_id = ?",
    )
    .bind(canvas_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Nao foi possivel listar os arquivos do quadro: {error}"))?;

    let mut files = Vec::with_capacity(rows.len());

    for (file_id, mime_type, relative_path) in rows {
        // O caminho relativo usa "/" — PathBuf::join resolve corretamente em
        // qualquer plataforma.
        let absolute_path = data_dir.join(&relative_path);

        // Arquivo sumiu do disco (limpeza manual, backup restaurado pela
        // metade...): degradar em vez de quebrar. O quadro abre sem ESTA
        // imagem (o Excalidraw mostra um placeholder no lugar) — melhor do
        // que o load inteiro falhar e o usuario perder acesso ao resto.
        match std::fs::read(&absolute_path) {
            Ok(bytes) => files.push(CanvasFileData {
                file_id,
                mime_type,
                data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            }),
            Err(error) => {
                eprintln!("canvas {canvas_id}: arquivo {relative_path} ilegivel, pulando: {error}");
            }
        }
    }

    Ok(files)
}

// ===========================================================================
// save_notebook_asset / load_notebook_assets — binarios das paginas de Caderno.
//
// Primeira fase: infraestrutura de persistencia, sem alterar ainda o paste do
// editor. O HTML de notebook_pages.content deve guardar so referencias
// (`data-notebook-asset-id` no futuro); bytes ficam em disco.
// ===========================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotebookAssetMetadata {
    id: String,
    notebook_id: String,
    page_id: String,
    mime_type: String,
    file_path: String,
    file_size: i64,
    checksum: Option<String>,
    original_name: Option<String>,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotebookAssetData {
    id: String,
    notebook_id: String,
    page_id: String,
    mime_type: String,
    file_path: String,
    file_size: i64,
    checksum: Option<String>,
    original_name: Option<String>,
    created_at: String,
    data_base64: String,
}

#[tauri::command]
// Comando Tauri recebe app handle, estado do banco e os campos do
// asset como parametros separados. Reduzir a lista exigiria um
// struct de entrada, o que muda o contrato IPC — fica para a
// decomposicao modular de lib.rs.
#[allow(clippy::too_many_arguments)]
async fn save_notebook_asset<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    notebook_id: String,
    page_id: String,
    asset_id: String,
    mime_type: String,
    data_base64: String,
    checksum: Option<String>,
    original_name: Option<String>,
) -> Result<NotebookAssetMetadata, String> {
    // Validacoes antes de qualquer escrita no disco.
    let notebook_id_number = validate_numeric_path_id(&notebook_id, "Identificador do caderno")?;
    let page_id_number = validate_numeric_path_id(&page_id, "Identificador da pagina")?;
    validate_file_id(&asset_id)?;
    let extension = notebook_asset_mime_to_extension(&mime_type)?;

    if data_base64.len() > (MAX_NOTEBOOK_ASSET_BYTES / 3 + 1) * 4 {
        return Err(format!(
            "Asset do caderno excede o limite de {}MB.",
            MAX_NOTEBOOK_ASSET_BYTES / 1024 / 1024
        ));
    }

    let data = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|error| format!("Base64 invalido: {error}"))?;

    if data.len() > MAX_NOTEBOOK_ASSET_BYTES {
        return Err(format!(
            "Asset do caderno excede o limite de {}MB.",
            MAX_NOTEBOOK_ASSET_BYTES / 1024 / 1024
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

    let existing_asset: Option<(String, String)> =
        sqlx::query_as("SELECT notebook_id, page_id FROM notebook_assets WHERE id = ?")
            .bind(&asset_id)
            .fetch_optional(pool)
            .await
            .map_err(|error| format!("Nao foi possivel verificar o asset do caderno: {error}"))?;

    if let Some((existing_notebook_id, existing_page_id)) = existing_asset {
        if existing_notebook_id != notebook_id || existing_page_id != page_id {
            return Err("Identificador de asset ja esta em uso por outra pagina.".to_string());
        }
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
    let relative_path = format!("notebook-assets/{notebook_id}/{page_id}/{asset_id}.{extension}");
    let final_path = data_dir
        .join("notebook-assets")
        .join(&notebook_id)
        .join(&page_id)
        .join(format!("{asset_id}.{extension}"));

    if final_path.exists() {
        let existing_size = std::fs::metadata(&final_path)
            .map_err(|error| format!("Nao foi possivel inspecionar o asset existente: {error}"))?
            .len();

        if existing_size != data.len() as u64 {
            return Err("Asset do caderno ja existe em disco com tamanho diferente.".to_string());
        }
    } else {
        if let Some(parent) = final_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("Nao foi possivel criar a pasta de assets do caderno: {error}")
            })?;
        }

        let temp_path = final_path.with_extension(format!("{extension}.tmp"));

        std::fs::write(&temp_path, &data)
            .map_err(|error| format!("Nao foi possivel gravar o asset do caderno: {error}"))?;

        if let Err(error) = std::fs::rename(&temp_path, &final_path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "Nao foi possivel finalizar o asset do caderno: {error}"
            ));
        }
    }

    sqlx::query(
        "INSERT INTO notebook_assets \
       (id, notebook_id, page_id, mime_type, file_path, file_size, checksum, original_name) \
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
     ON CONFLICT (id) DO UPDATE SET \
       notebook_id = excluded.notebook_id, \
       page_id = excluded.page_id, \
       mime_type = excluded.mime_type, \
       file_path = excluded.file_path, \
       file_size = excluded.file_size, \
       checksum = excluded.checksum, \
       original_name = excluded.original_name",
    )
    .bind(&asset_id)
    .bind(&notebook_id)
    .bind(&page_id)
    .bind(&mime_type)
    .bind(&relative_path)
    .bind(data.len() as i64)
    .bind(&checksum)
    .bind(&original_name)
    .execute(pool)
    .await
    .map_err(|error| format!("Nao foi possivel registrar o asset do caderno: {error}"))?;

    let row: (String, String, String, String, String, i64, Option<String>, Option<String>, String) = sqlx::query_as(
    "SELECT id, notebook_id, page_id, mime_type, file_path, file_size, checksum, original_name, created_at \
     FROM notebook_assets WHERE id = ?",
  )
  .bind(&asset_id)
  .fetch_one(pool)
  .await
  .map_err(|error| format!("Nao foi possivel carregar o asset salvo do caderno: {error}"))?;

    Ok(NotebookAssetMetadata {
        id: row.0,
        notebook_id: row.1,
        page_id: row.2,
        mime_type: row.3,
        file_path: row.4,
        file_size: row.5,
        checksum: row.6,
        original_name: row.7,
        created_at: row.8,
    })
}

#[tauri::command]
async fn load_notebook_assets<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    page_id: String,
) -> Result<Vec<NotebookAssetData>, String> {
    validate_numeric_path_id(&page_id, "Identificador da pagina")?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;

    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err("Banco de dados nao carregado.".to_string()),
    };

    // Tupla espelha as colunas do SELECT abaixo. Extrair um type alias
    // aqui separaria a forma do tipo da query que a produz — fica para
    // a decomposicao modular de lib.rs.
    #[allow(clippy::type_complexity)]
    let rows: Vec<(String, String, String, String, String, i64, Option<String>, Option<String>, String)> = sqlx::query_as(
    "SELECT id, notebook_id, page_id, mime_type, file_path, file_size, checksum, original_name, created_at \
     FROM notebook_assets WHERE page_id = ? ORDER BY created_at ASC, id ASC",
  )
  .bind(&page_id)
  .fetch_all(pool)
  .await
  .map_err(|error| format!("Nao foi possivel listar os assets do caderno: {error}"))?;

    let mut assets = Vec::with_capacity(rows.len());

    for (
        id,
        notebook_id,
        page_id,
        mime_type,
        file_path,
        file_size,
        checksum,
        original_name,
        created_at,
    ) in rows
    {
        let absolute_path = data_dir.join(&file_path);

        match std::fs::read(&absolute_path) {
            Ok(bytes) => assets.push(NotebookAssetData {
                id,
                notebook_id,
                page_id,
                mime_type,
                file_path,
                file_size,
                checksum,
                original_name,
                created_at,
                data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            }),
            Err(error) => {
                eprintln!("notebook page {page_id}: asset {file_path} ilegivel, pulando: {error}");
            }
        }
    }

    Ok(assets)
}

// ===========================================================================
// save_notebook_file_attachment / load_notebook_file_attachments — arquivos
// anexados as paginas de Caderno. Primeira fase: sem abrir/revelar/remover.
// ===========================================================================

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

// ===========================================================================
// Wallpaper do app — importacao e persistencia do arquivo em disco.
//
// Por que Rust, e nao TypeScript: a operacao e filesystem puro (ler um arquivo
// escolhido pelo usuario, copiar para o diretorio de dados do app, apagar o
// anterior) e precisa de canonicalizacao de caminho e finalizacao segura —
// exatamente a divisao de responsabilidades de save_notebook_asset.
//
// Diferenca em relacao aos assets de caderno: os bytes NAO atravessam o IPC.
// O frontend manda apenas o caminho de origem e o Rust copia de disco para
// disco. Um wallpaper 4K em base64 seria ~21MB de string atravessando a
// fronteira para nada.
//
// O que fica em app_settings (wallpaper_file / wallpaper_opacity /
// wallpaper_brightness) e escrito pelo TypeScript: sao upserts chave-valor
// independentes, cada um atomico
// numa unica instrucao SQL, e AGENTS.md e explicito em nao criar comando Rust
// para o que o plugin-sql ja resolve com seguranca.
// ===========================================================================

// Teto de tamanho do wallpaper: 16MB — 4x o limite de asset/anexo de caderno.
//
// Por que maior: um anexo e UM entre centenas por caderno, e o teto de 4MB
// existe para limitar o acumulado. O wallpaper e um arquivo global unico, o
// custo em disco nao acumula, e o insumo tipico e outro — um papel de parede
// de desktop nasce na resolucao da tela, nao redimensionado para caber num
// paragrafo. Um PNG 4K fica entre ~5MB (arte chapada) e ~15MB (fotografico);
// o mesmo quadro em JPEG ou WebP raramente passa de 5MB. 16MB cobre o PNG 4K
// no caso comum e ainda rejeita o que so pode ser engano (um painel de varios
// monitores, um RAW convertido sem perdas).
//
// O limite e do ARQUIVO, nao do bitmap decodificado: 3840x2160 em RGBA ocupa
// ~33MB na memoria do WebView independentemente da compressao. Quem limita
// isso e a resolucao da imagem, nao este teto — e nao e o que este numero
// promete.
const MAX_WALLPAPER_BYTES: u64 = 16 * 1024 * 1024;

// Subpasta do diretorio de dados do app. E TAMBEM o escopo do protocolo asset
// declarado em tauri.conf.json ($APPDATA/wallpaper/*): mudar este nome exige
// mudar la, senao a imagem para de ser servida ao WebView.
const WALLPAPER_DIR_NAME: &str = "wallpaper";

// 12 bytes bastam para os tres formatos da allowlist: PNG usa 8, JPEG 3 e WebP
// precisa de "RIFF" (0..4) mais "WEBP" (8..12).
const WALLPAPER_HEADER_BYTES: usize = 12;

const WALLPAPER_EXTENSIONS: [&str; 3] = ["png", "jpg", "webp"];

// Caminhos de origem AUTORIZADOS pelo usuario no dialogo nativo nesta sessao,
// no mesmo padrao de NotebookExportDestinations.
//
// Sem isto, import_wallpaper seria uma primitiva de leitura de arquivo
// arbitrario para qualquer codigo que rode no WebView: bastaria invocar o
// comando com um caminho qualquer para que a imagem fosse copiada para dentro
// da pasta servida pelo protocolo asset e lida de volta. O app renderiza PDF
// de terceiros e HTML persistido do Caderno — o WebView nao e uma fronteira
// confiavel. Com a autorizacao, todo caminho de leitura passou por uma escolha
// explicita do usuario num dialogo do sistema operacional.
#[derive(Default)]
struct WallpaperImportSources(std::sync::Mutex<HashSet<PathBuf>>);

// No fluxo normal ha no maximo uma escolha pendente (dialogo -> importar, que
// consome). Escolhas abandonadas (dialogo aberto e import cancelado) nao devem
// se acumular numa sessao longa.
const MAX_AUTHORIZED_WALLPAPER_SOURCES: usize = 8;

#[derive(Serialize)]
struct SelectedWallpaperImage {
    file_name: String,
    file_path: String,
}

#[derive(Serialize)]
struct ImportedWallpaper {
    // Nome do arquivo dentro da pasta wallpaper/ — e ISTO que vai para
    // app_settings.wallpaper_file. Caminho absoluto nunca e persistido: ele
    // muda entre maquinas e entre o perfil .dev e o de producao.
    file_name: String,
    // Caminho absoluto so para a sessao atual, para o frontend converter em URL
    // do protocolo asset e desenhar a previa.
    file_path: String,
    file_size: u64,
}

// Allowlist POR CONTEUDO, nao por extensao: a extensao e um palpite do nome do
// arquivo, e um arquivo chamado "papel.png" pode ser qualquer coisa. Como a
// pasta de destino e servida ao WebView pelo protocolo asset, gravar la um
// arquivo que nao e imagem seria transformar a pasta num deposito de conteudo
// arbitrario acessivel por URL. A extensao gravada em disco e DERIVADA daqui.
fn detect_wallpaper_extension(header: &[u8]) -> Result<&'static str, String> {
    const PNG_MAGIC: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    const JPEG_MAGIC: &[u8] = &[0xFF, 0xD8, 0xFF];

    if header.starts_with(PNG_MAGIC) {
        return Ok("png");
    }

    if header.starts_with(JPEG_MAGIC) {
        return Ok("jpg");
    }

    if header.len() >= WALLPAPER_HEADER_BYTES
        && &header[0..4] == b"RIFF"
        && &header[8..12] == b"WEBP"
    {
        return Ok("webp");
    }

    Err("Formato de imagem nao suportado. Use PNG, JPEG ou WebP.".to_string())
}

// O nome do arquivo chega do SQLite, e o SQLite NAO e uma fronteira de
// confianca: o plugin-sql expoe execute ao frontend, entao qualquer codigo
// rodando no WebView consegue escrever em app_settings. O nome so e aceito na
// forma exata que o import gera — minusculas, digitos e hifen, mais uma
// extensao da allowlist. Isso barra "../", caminho absoluto, separador de
// diretorio e nome com truque de unicode antes de virar caminho.
fn validate_wallpaper_file_name(file_name: &str) -> Result<(), String> {
    let invalid = || "Nome de arquivo de wallpaper invalido.".to_string();

    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return Err(invalid());
    };

    if !WALLPAPER_EXTENSIONS.contains(&extension) {
        return Err(invalid());
    }

    if stem.is_empty()
        || stem.len() > 64
        || !stem.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err(invalid());
    }

    Ok(())
}

fn wallpaper_directory(data_dir: &Path) -> PathBuf {
    data_dir.join(WALLPAPER_DIR_NAME)
}

// Nome unico por importacao, em vez de um "wallpaper.png" fixo. Dois motivos: o
// WebView2 cacheia por URL, entao reusar o nome mostraria a imagem antiga
// depois de trocar; e um nome novo torna a promocao do arquivo novo
// independente da remocao do antigo (nunca sobrescrevemos o arquivo que ainda
// esta sendo exibido).
fn wallpaper_file_name(extension: &str) -> String {
    let token = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string());

    format!("wallpaper-{token}.{extension}")
}

// Resolve o nome persistido para um caminho absoluto DENTRO da pasta de
// wallpaper. A validacao de nome acima ja barra traversal na string; a
// canonicalizacao aqui fecha o que a string nao mostra — um link simbolico
// plantado na pasta apontaria para fora dela e, servido pelo protocolo asset,
// viraria uma janela para um arquivo arbitrario do disco.
//
// Devolve o caminho NAO canonicalizado de proposito: no Windows canonicalize
// devolve a forma \\?\C:\..., que nao e o que o convertFileSrc do frontend
// espera. A forma canonica serve para decidir, nao para trafegar.
fn resolve_wallpaper_file(wallpaper_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    validate_wallpaper_file_name(file_name)?;

    let candidate = wallpaper_dir.join(file_name);

    let canonical_dir = wallpaper_dir
        .canonicalize()
        .map_err(|_| "Pasta de wallpaper indisponivel.".to_string())?;
    let canonical_file = candidate
        .canonicalize()
        .map_err(|_| "Arquivo de wallpaper indisponivel.".to_string())?;

    if !canonical_file.starts_with(&canonical_dir) {
        return Err("Arquivo de wallpaper fora da pasta do app.".to_string());
    }

    Ok(candidate)
}

// Um wallpaper por vez: tudo que nao for `keep` sai da pasta.
//
// Varrer o diretorio e melhor do que apagar o nome anterior lido do banco por
// dois motivos: nao depende de o banco estar coerente (se a gravacao da chave
// falhou numa troca anterior, o arquivo orfao ainda assim sai agora), e recolhe
// tambem os temporarios deixados por uma queda no meio de uma escrita.
//
// Best-effort de proposito: a imagem nova ja esta promovida e valida quando
// isto roda. No Windows o arquivo anterior pode estar momentaneamente aberto
// pelo protocolo asset servindo a previa; falhar a remocao nao pode invalidar
// uma importacao que deu certo — a proxima varredura recolhe.
//
// So remove ARQUIVOS. A pasta e criada e preenchida apenas por este modulo,
// entao um diretorio ali dentro nao veio daqui; apagar recursivamente algo que
// nao criamos e destrutivo sem necessidade.
fn sweep_wallpaper_directory(wallpaper_dir: &Path, keep: Option<&str>) {
    let Ok(entries) = std::fs::read_dir(wallpaper_dir) else {
        return;
    };

    for entry in entries.flatten() {
        if keep.is_some_and(|kept| entry.file_name() == *std::ffi::OsStr::new(kept)) {
            continue;
        }

        let path = entry.path();
        if path.is_file() {
            let _ = std::fs::remove_file(&path);
        }
    }
}

// Le no maximo header.len() bytes, tolerando leituras curtas e EINTR.
// read_exact nao serve: um arquivo menor que o cabecalho e entrada valida do
// usuario (so nao e uma imagem suportada) e nao pode virar erro de I/O.
fn fill_wallpaper_header<R: std::io::Read>(
    reader: &mut R,
    header: &mut [u8],
) -> std::io::Result<usize> {
    let mut filled = 0;

    while filled < header.len() {
        match reader.read(&mut header[filled..]) {
            Ok(0) => break,
            Ok(bytes_read) => filled += bytes_read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }

    Ok(filled)
}

// Escreve cabecalho + resto do arquivo no temporario, com teto rigido de
// tamanho. O take limita a leitura a UM byte alem do permitido: se esse byte
// extra aparecer, o arquivo cresceu depois do metadata e a copia e recusada.
fn write_wallpaper_temp<R: std::io::Read>(
    temp_path: &Path,
    header: &[u8],
    reader: &mut R,
) -> Result<u64, String> {
    let temp_file = File::create(temp_path)
        .map_err(|error| format!("Nao foi possivel gravar a imagem de wallpaper: {error}"))?;
    let mut writer = BufWriter::new(temp_file);

    writer
        .write_all(header)
        .map_err(|error| format!("Nao foi possivel gravar a imagem de wallpaper: {error}"))?;

    let remaining_budget = MAX_WALLPAPER_BYTES - header.len() as u64 + 1;
    let copied = std::io::copy(&mut reader.take(remaining_budget), &mut writer)
        .map_err(|error| format!("Nao foi possivel gravar a imagem de wallpaper: {error}"))?;

    let total = header.len() as u64 + copied;
    if total > MAX_WALLPAPER_BYTES {
        return Err(format!(
            "A imagem excede o limite de {}MB. Use uma versao em JPEG ou WebP.",
            MAX_WALLPAPER_BYTES / 1024 / 1024
        ));
    }

    writer
        .flush()
        .map_err(|error| format!("Nao foi possivel gravar a imagem de wallpaper: {error}"))?;

    // sync_all antes do rename: garante que os BYTES chegaram ao disco antes de
    // o nome definitivo passar a existir. Sem isso o rename pode ser persistido
    // antes do conteudo, e a queda deixaria justamente o arquivo truncado com
    // nome valido que o temp+rename existe para evitar.
    let temp_file = writer
        .into_inner()
        .map_err(|error| format!("Nao foi possivel gravar a imagem de wallpaper: {error}"))?;
    temp_file
        .sync_all()
        .map_err(|error| format!("Nao foi possivel finalizar a imagem de wallpaper: {error}"))?;

    Ok(total)
}

// Copia a imagem de origem para a pasta de wallpaper e devolve (nome, bytes).
//
// POR QUE TEMP + RENAME, e nao escrita direta no destino: rename no mesmo
// volume e atomico. Um corte de energia ou um kill no meio da escrita deixa, no
// pior caso, um temporario orfao — que a varredura recolhe na proxima
// importacao. Escrevendo direto no nome final, a mesma queda deixaria um
// arquivo truncado com o nome DEFINITIVO, que o app tentaria carregar no
// proximo boot: uma imagem quebrada, ou pior, um cabecalho valido com o corpo
// pela metade. O destino so passa a existir quando o conteudo ja esta inteiro
// no disco.
fn import_wallpaper_file(wallpaper_dir: &Path, source: &Path) -> Result<(String, u64), String> {
    let metadata = std::fs::metadata(source)
        .map_err(|_| "Nao foi possivel ler a imagem escolhida.".to_string())?;

    if !metadata.is_file() {
        return Err("A origem escolhida nao e um arquivo.".to_string());
    }

    if metadata.len() == 0 {
        return Err("A imagem escolhida esta vazia.".to_string());
    }

    // Checagem barata antes de abrir o arquivo. Nao dispensa a checagem do total
    // copiado la embaixo: entre o metadata e a leitura o arquivo pode crescer (o
    // dono do arquivo e o usuario, nao o app).
    if metadata.len() > MAX_WALLPAPER_BYTES {
        return Err(format!(
            "A imagem excede o limite de {}MB. Use uma versao em JPEG ou WebP.",
            MAX_WALLPAPER_BYTES / 1024 / 1024
        ));
    }

    let file = File::open(source).map_err(|_| "Nao foi possivel abrir a imagem.".to_string())?;
    let mut reader = BufReader::new(file);

    let mut header = [0u8; WALLPAPER_HEADER_BYTES];
    let header_len = fill_wallpaper_header(&mut reader, &mut header)
        .map_err(|_| "Nao foi possivel ler a imagem escolhida.".to_string())?;
    let extension = detect_wallpaper_extension(&header[..header_len])?;

    std::fs::create_dir_all(wallpaper_dir)
        .map_err(|error| format!("Nao foi possivel criar a pasta de wallpaper: {error}"))?;

    let file_name = wallpaper_file_name(extension);
    let final_path = wallpaper_dir.join(&file_name);
    let temp_path = wallpaper_dir.join(format!("{file_name}.tmp"));

    let written = match write_wallpaper_temp(&temp_path, &header[..header_len], &mut reader) {
        Ok(written) => written,
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            return Err(error);
        }
    };

    if let Err(error) = std::fs::rename(&temp_path, &final_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "Nao foi possivel finalizar a imagem de wallpaper: {error}"
        ));
    }

    // Varre DEPOIS da promocao: se algo falhar antes daqui, o wallpaper anterior
    // continua intacto no disco e o usuario nao perde o que tinha.
    sweep_wallpaper_directory(wallpaper_dir, Some(file_name.as_str()));

    Ok((file_name, written))
}

// Dialogo nativo, no padrao de select_pdf_files: comando SINCRONO (o dialogo do
// sistema quer a thread principal) que so escolhe — nao copia nada. A copia e
// um comando separado justamente porque e ela que demora, e a UI precisa saber
// diferenciar "usuario esta escolhendo" de "app esta copiando".
#[tauri::command]
fn select_wallpaper_image(
    sources: tauri::State<'_, WallpaperImportSources>,
) -> Result<Option<SelectedWallpaperImage>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Imagem", &["png", "jpg", "jpeg", "webp"])
        .pick_file()
    else {
        return Ok(None);
    };

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("imagem")
        .to_string();

    // Registra a escolha do usuario. A comparacao no import e pelo PathBuf exato
    // devolvido aqui — ida e volta literal, sem normalizacao.
    let mut authorized = sources
        .0
        .lock()
        .map_err(|_| "Estado de importacao indisponivel.".to_string())?;
    if authorized.len() >= MAX_AUTHORIZED_WALLPAPER_SOURCES {
        authorized.clear();
    }
    authorized.insert(path.clone());
    drop(authorized);

    Ok(Some(SelectedWallpaperImage {
        file_name,
        file_path: path.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
async fn import_wallpaper<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    sources: tauri::State<'_, WallpaperImportSources>,
    source_path: String,
) -> Result<ImportedWallpaper, String> {
    let source = PathBuf::from(&source_path);

    // Autorizacao: o caminho precisa ter saido do dialogo nativo NESTA sessao.
    // O lock e curto e nunca atravessa um await.
    {
        let authorized = sources
            .0
            .lock()
            .map_err(|_| "Estado de importacao indisponivel.".to_string())?;
        if !authorized.contains(&source) {
            return Err("Imagem nao autorizada pelo usuario.".to_string());
        }
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
    let wallpaper_dir = wallpaper_directory(&data_dir);

    let (file_name, file_size) = import_wallpaper_file(&wallpaper_dir, &source)?;

    // Autorizacao consumida: uma escolha no dialogo = uma importacao concluida.
    // Uma falha nao consome, entao o usuario pode tentar de novo sem reabrir o
    // dialogo.
    if let Ok(mut authorized) = sources.0.lock() {
        authorized.remove(&source);
    }

    Ok(ImportedWallpaper {
        file_path: wallpaper_dir.join(&file_name).to_string_lossy().to_string(),
        file_name,
        file_size,
    })
}

// Traduz o nome persistido em app_settings para o caminho absoluto da sessao.
// Devolve None quando o arquivo nao existe mais (pasta apagada por fora, troca
// de perfil), para o frontend limpar a chave em vez de insistir num caminho
// morto.
#[tauri::command]
fn resolve_wallpaper_path<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    file_name: String,
) -> Result<Option<String>, String> {
    validate_wallpaper_file_name(&file_name)?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;
    let wallpaper_dir = wallpaper_directory(&data_dir);

    if !wallpaper_dir.join(&file_name).is_file() {
        return Ok(None);
    }

    Ok(Some(
        resolve_wallpaper_file(&wallpaper_dir, &file_name)?
            .to_string_lossy()
            .to_string(),
    ))
}

// Remove a imagem do disco. A chave em app_settings e limpa pelo frontend,
// DEPOIS desta chamada: se a ordem fosse a inversa e a remocao falhasse, a
// interface diria "sem wallpaper" com o arquivo ainda servido pelo protocolo
// asset.
#[tauri::command]
fn remove_wallpaper<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;

    sweep_wallpaper_directory(&wallpaper_directory(&data_dir), None);

    Ok(())
}

// ===========================================================================
// write_notebook_export — Fase 3 da exportacao de Cadernos.
//
// Recebe o HTML ja sanitizado (com sentinelas de slot) e o manifest tipado,
// resolve cada slot para o recurso REAL e escreve o arquivo final:
//   - imagem de asset -> <img src="data:...">
//   - anexo           -> <a download href="data:...">
//
// O base64 e gerado em STREAMING: EncoderWriter escreve direto no arquivo de
// saida, um recurso por vez, entao nunca existe uma copia base64 completa de
// todos os assets na memoria. O banco (e nao o frontend) e a fonte de verdade
// de caminho fisico, mime e propriedade: cada slot so e embutido se o recurso
// pertencer ao caderno e as paginas exportadas. Diagramas e equacoes seguem
// com o fallback estatico da fase anterior — aqui so entram assets e anexos.
// ===========================================================================

// Contrato FECHADO com o builder TS (notebookExportHtml.ts): todos os campos
// do manifest sao declarados e deny_unknown_fields rejeita qualquer campo
// extra. Se o contrato evoluir, os dois lados mudam juntos — um manifest com
// formato inesperado e erro imediato, nao aceitacao silenciosa.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotebookExportSlotInput {
    slot_id: String,
    kind: String,
    resource_id: String,
    page_id: i64,
    occurrence: u32,
    alt_text: Option<String>,
    caption: Option<String>,
    display_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotebookExportManifestInput {
    version: u32,
    nonce: String,
    notebook_id: i64,
    notebook_title: String,
    scope: String,
    page_ids: Vec<i64>,
    created_at: String,
    slots: Vec<NotebookExportSlotInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotebookExportRuntimeWarning {
    code: String,
    slot_id: Option<String>,
    page_id: Option<i64>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotebookExportWriteResult {
    path: String,
    bytes_written: i64,
    embedded_assets: u32,
    embedded_attachments: u32,
    missing_resources: u32,
    warnings: Vec<NotebookExportRuntimeWarning>,
}

enum ResolvedEmbed {
    Asset {
        path: PathBuf,
        mime: String,
        alt: String,
    },
    Attachment {
        path: PathBuf,
        mime: String,
        download_name: String,
        visible_name: String,
    },
}

struct ParsedExportSentinel {
    start: usize,
    end: usize,
    nonce: String,
    slot_id: String,
}

const EXPORT_WARNING_MISSING_RESOURCE: &str = "missing-resource";
const EXPORT_WARNING_MISSING_FILE: &str = "missing-file";
const EXPORT_WARNING_INVALID_ASSET_MIME_TYPE: &str = "invalid-asset-mime-type";
const EXPORT_WARNING_UNKNOWN_ATTACHMENT_MIME_TYPE: &str = "unknown-attachment-mime-type";
const EXPORT_WARNING_BACKUP_CLEANUP_FAILED: &str = "backup-cleanup-failed";

// Localiza as sentinelas `<!--ATHENAEUM_SLOT:{nonce}:{slotId}-->` na ordem em
// que aparecem, devolvendo os offsets em bytes. Pura e testavel. Um comentario
// HTML nao pode conter "-->", entao o par prefixo/sufixo delimita cada
// sentinela sem ambiguidade.
fn parse_export_slot_sentinels(html: &str) -> Vec<ParsedExportSentinel> {
    const PREFIX: &str = "<!--ATHENAEUM_SLOT:";
    const SUFFIX: &str = "-->";
    let mut sentinels = Vec::new();
    let mut search_from = 0usize;

    while let Some(relative_start) = html[search_from..].find(PREFIX) {
        let start = search_from + relative_start;
        let content_start = start + PREFIX.len();
        let Some(relative_end) = html[content_start..].find(SUFFIX) else {
            break;
        };
        let content_end = content_start + relative_end;
        let end = content_end + SUFFIX.len();

        if let Some((nonce, slot_id)) = html[content_start..content_end].split_once(':') {
            sentinels.push(ParsedExportSentinel {
                start,
                end,
                nonce: nonce.to_string(),
                slot_id: slot_id.to_string(),
            });
        }

        search_from = end;
    }

    sentinels
}

// Consistencia ESTRUTURAL entre HTML e manifest — FATAL. Os dois nascem juntos
// do mesmo builder TS (as sentinelas sao emitidas na MESMA operacao que cria o
// slot) e sao cruzados la em validateNotebookExportManifestSlots. Uma
// divergencia aqui — nonce trocado, sentinela sem slot no manifest, sentinela
// repetida, ou slot sem sentinela — nao acontece num build correto: significa
// adulteracao ou bug, e a exportacao inteira deixa de ser confiavel. Por isso
// aborta ANTES de criar qualquer arquivo, em vez de gravar um HTML cheio de
// placeholders silenciosos. Problemas de RECURSO individual (arquivo sumido,
// propriedade) NAO passam por aqui — la a estrutura esta integra e so o
// recurso e que nao pode ser embutido, entao degradam com aviso.
fn validate_export_html_against_manifest(
    sentinels: &[ParsedExportSentinel],
    manifest: &NotebookExportManifestInput,
) -> Result<(), String> {
    let manifest_slot_ids: HashSet<&str> = manifest
        .slots
        .iter()
        .map(|slot| slot.slot_id.as_str())
        .collect();
    let mut seen_slot_ids: HashSet<&str> = HashSet::with_capacity(sentinels.len());

    for sentinel in sentinels {
        if sentinel.nonce != manifest.nonce {
            return Err("Sentinela do HTML com nonce divergente do manifest.".to_string());
        }
        if !manifest_slot_ids.contains(sentinel.slot_id.as_str()) {
            return Err(format!(
                "Sentinela {} nao consta do manifest.",
                sentinel.slot_id
            ));
        }
        if !seen_slot_ids.insert(sentinel.slot_id.as_str()) {
            return Err(format!("Sentinela {} duplicada no HTML.", sentinel.slot_id));
        }
    }

    // Todo slot do manifest precisa ter exatamente uma sentinela no HTML.
    for slot in &manifest.slots {
        if !seen_slot_ids.contains(slot.slot_id.as_str()) {
            return Err(format!(
                "Slot {} do manifest sem sentinela no HTML.",
                slot.slot_id
            ));
        }
    }

    Ok(())
}

// Propriedade do recurso: o slot so pode embutir um recurso cujo dono no banco
// (notebook_id/page_id) casa com o caderno e a pagina que o slot declara. Puro
// e testavel; os dois tipos de recurso comparam como texto (notebook_assets
// guarda TEXT; anexos convertem os i64 para string na chamada). Fail-closed:
// qualquer divergencia devolve false e o chamador aborta.
fn export_owner_matches(
    row_notebook_id: &str,
    row_page_id: &str,
    manifest_notebook_id: i64,
    slot_page_id: i64,
) -> bool {
    row_notebook_id == manifest_notebook_id.to_string() && row_page_id == slot_page_id.to_string()
}

fn escape_export_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn is_data_uri_mime_char(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || matches!(
            character,
            '!' | '#' | '$' | '&' | '^' | '_' | '.' | '+' | '-'
        )
}

// Mime que entra num `data:` URI precisa ser um token seguro: sem aspas nem
// caracteres que escapem do atributo. Qualquer coisa fora do formato
// `tipo/subtipo` vira application/octet-stream.
fn parse_safe_data_uri_mime(mime: &str) -> Option<String> {
    let trimmed = mime.trim();
    let is_valid = trimmed.len() <= 128
        && trimmed
            .split_once('/')
            .map(|(kind, subtype)| {
                !kind.is_empty()
                    && !subtype.is_empty()
                    && kind.chars().all(is_data_uri_mime_char)
                    && subtype.chars().all(is_data_uri_mime_char)
            })
            .unwrap_or(false);

    if is_valid {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn sanitize_data_uri_mime(mime: &str) -> String {
    parse_safe_data_uri_mime(mime).unwrap_or_else(|| "application/octet-stream".to_string())
}

// Allowlist FECHADA de imagem para o export, espelhando notebook_asset_mime_to_extension
// (o save so aceita estes 4; svg e rejeitado). Um asset e sempre embutido num
// <img src="data:...">, entao seu MIME precisa ser um tipo de imagem real —
// nao basta ser um token bem-formado. Rechecar aqui e defesa em profundidade:
// um MIME fora da lista significa registro corrompido no banco, e o asset e
// tratado como recurso inutilizavel (degrada), nunca embutido como imagem.
fn is_supported_export_image_mime(mime: &str) -> bool {
    matches!(
        mime.trim(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    )
}

fn write_missing_resource_placeholder<W: Write>(writer: &mut W) -> std::io::Result<()> {
    writer.write_all(b"<span class=\"athenaeum-export__missing\">[recurso indisponivel]</span>")
}

// Escreve `data:{mime};base64,<bytes>` direto no writer de saida, codificando
// o base64 em STREAMING: o EncoderWriter le e codifica em blocos, sem
// materializar a string base64 inteira. A memoria fica limitada ao buffer de
// um arquivo por vez.
fn stream_embed_data_uri<W: Write>(writer: &mut W, path: &Path, mime: &str) -> std::io::Result<()> {
    write!(writer, "data:{mime};base64,")?;
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut encoder = EncoderWriter::new(&mut *writer, &base64::engine::general_purpose::STANDARD);
    std::io::copy(&mut reader, &mut encoder)?;
    encoder.finish()?;
    Ok(())
}

fn export_slot_warning(
    code: &str,
    slot: &NotebookExportSlotInput,
    message: &str,
) -> NotebookExportRuntimeWarning {
    NotebookExportRuntimeWarning {
        code: code.to_string(),
        slot_id: Some(slot.slot_id.clone()),
        page_id: Some(slot.page_id),
        message: message.to_string(),
    }
}

fn export_runtime_warning(code: &str, message: &str) -> NotebookExportRuntimeWarning {
    NotebookExportRuntimeWarning {
        code: code.to_string(),
        slot_id: None,
        page_id: None,
        message: message.to_string(),
    }
}

fn resolve_attachment_export_mime(
    mime_type: Option<&str>,
    slot: &NotebookExportSlotInput,
) -> (String, Option<NotebookExportRuntimeWarning>) {
    let Some(raw_mime) = mime_type else {
        return (
            "application/octet-stream".to_string(),
            Some(export_slot_warning(
                EXPORT_WARNING_UNKNOWN_ATTACHMENT_MIME_TYPE,
                slot,
                "Tipo de anexo desconhecido; application/octet-stream foi usado.",
            )),
        );
    };

    let Some(safe_mime) = parse_safe_data_uri_mime(raw_mime) else {
        return (
            "application/octet-stream".to_string(),
            Some(export_slot_warning(
                EXPORT_WARNING_UNKNOWN_ATTACHMENT_MIME_TYPE,
                slot,
                "Tipo de anexo desconhecido; application/octet-stream foi usado.",
            )),
        );
    };

    (safe_mime, None)
}

// O manifest chega pelo IPC e e input NAO confiavel, mesmo tendo sido gerado
// pelo nosso builder TS. Os padroes espelham os de notebookExportHtml.ts
// (nonce [a-zA-Z0-9-]{8,80}, slot "slot-<numero>"). Manifest fora do padrao e
// violacao de CONTRATO e aborta a exportacao — diferente de um recurso
// individual ausente, que degrada com aviso.
fn validate_export_nonce(nonce: &str) -> Result<(), String> {
    let is_valid = (8..=80).contains(&nonce.len())
        && nonce
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');

    if is_valid {
        Ok(())
    } else {
        Err("Nonce de exportacao invalido.".to_string())
    }
}

fn validate_export_slot_id(slot_id: &str) -> Result<(), String> {
    let is_valid = slot_id
        .strip_prefix("slot-")
        .map(|digits| {
            !digits.is_empty() && digits.len() <= 9 && digits.chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or(false);

    if is_valid {
        Ok(())
    } else {
        Err("Slot de exportacao invalido.".to_string())
    }
}

const MAX_NOTEBOOK_EXPORT_SLOTS: usize = 10_000;
const SUPPORTED_NOTEBOOK_EXPORT_MANIFEST_VERSION: u32 = 1;
// Sanidade dos campos textuais que atravessam o IPC: caps generosos (nenhum
// valor legitimo chega perto), sem checagem de conteudo para nao rejeitar
// titulos/captions reais do usuario.
const MAX_EXPORT_TITLE_CHARS: usize = 512;
const MAX_EXPORT_TEXT_FIELD_CHARS: usize = 4_096;

fn validate_export_optional_text(value: &Option<String>, label: &str) -> Result<(), String> {
    if let Some(text) = value {
        if text.chars().count() > MAX_EXPORT_TEXT_FIELD_CHARS {
            return Err(format!("{label} excede o tamanho maximo no manifest."));
        }
    }

    Ok(())
}

fn validate_export_manifest(manifest: &NotebookExportManifestInput) -> Result<(), String> {
    if manifest.version != SUPPORTED_NOTEBOOK_EXPORT_MANIFEST_VERSION {
        return Err("Versao do manifest de exportacao nao suportada.".to_string());
    }

    validate_export_nonce(&manifest.nonce)?;

    if manifest.notebook_id <= 0 {
        return Err("Identificador do caderno invalido.".to_string());
    }

    if manifest.scope != "current-page" && manifest.scope != "full-notebook" {
        return Err("Escopo de exportacao invalido no manifest.".to_string());
    }

    if manifest.notebook_title.chars().count() > MAX_EXPORT_TITLE_CHARS {
        return Err("Titulo do caderno excede o tamanho maximo no manifest.".to_string());
    }

    if manifest.created_at.is_empty() || manifest.created_at.len() > 64 {
        return Err("Data de criacao invalida no manifest.".to_string());
    }

    if manifest.page_ids.is_empty() {
        return Err("Exportacao sem paginas no manifest.".to_string());
    }

    if manifest.page_ids.iter().any(|page_id| *page_id <= 0) {
        return Err("Identificador de pagina invalido no manifest.".to_string());
    }

    if manifest.slots.len() > MAX_NOTEBOOK_EXPORT_SLOTS {
        return Err("Manifest de exportacao excede o limite de slots.".to_string());
    }

    let mut seen_slot_ids: HashSet<&str> = HashSet::with_capacity(manifest.slots.len());
    for slot in &manifest.slots {
        validate_export_slot_id(&slot.slot_id)?;
        if !seen_slot_ids.insert(slot.slot_id.as_str()) {
            return Err(format!("Slot duplicado no manifest: {}.", slot.slot_id));
        }

        // Tipos de recurso sao um conjunto fechado do contrato; um kind
        // desconhecido e drift de versao ou adulteracao, nao degradacao.
        if slot.kind != "notebook-asset" && slot.kind != "notebook-attachment" {
            return Err(format!(
                "Tipo de recurso invalido no manifest: {}.",
                slot.kind
            ));
        }

        if slot.occurrence == 0 {
            return Err("Ocorrencia invalida no manifest.".to_string());
        }

        validate_export_optional_text(&slot.alt_text, "Texto alternativo")?;
        validate_export_optional_text(&slot.caption, "Legenda")?;
        validate_export_optional_text(&slot.display_name, "Nome de exibicao")?;
    }

    Ok(())
}

// O caminho de destino tambem e IPC nao confiavel: mesmo nascendo do dialogo
// nativo, ele faz ida e volta pelo WebView. Exigimos caminho ABSOLUTO com
// extensao .html/.htm — um WebView comprometido nao pode usar este comando
// para sobrescrever um arquivo arbitrario de outro tipo (.dll, .ps1, config).
fn validate_export_destination_shape(destination: &Path) -> Result<(), String> {
    if !destination.is_absolute() {
        return Err("Destino de exportacao invalido.".to_string());
    }

    let has_html_extension = destination
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm")
        })
        .unwrap_or(false);

    if !has_html_extension {
        return Err("O destino da exportacao deve ser um arquivo .html ou .htm.".to_string());
    }

    Ok(())
}

// Numero maximo de nomes candidatos para o temporario exclusivo. O nome base
// ja carrega o nonce (unico por export), entao a colisao so aconteceria com um
// orfao de execucao interrompida do MESMO export; o sufixo numerico cobre esse
// caso raro sem laco infinito.
const MAX_EXPORT_TEMP_ATTEMPTS: usize = 32;
const MAX_EXPORT_BACKUP_ATTEMPTS: usize = 32;

// Cria o temporario de forma EXCLUSIVA (create_new): ao contrario de
// File::create, NUNCA trunca um arquivo preexistente com o mesmo nome. Fica no
// mesmo diretorio do destino (sibling), condicao do rename atomico. Devolve o
// handle aberto e o caminho efetivamente usado.
fn create_exclusive_export_temp(
    destination: &Path,
    file_name: &std::ffi::OsStr,
    nonce: &str,
) -> Result<(File, PathBuf), String> {
    for attempt in 0..MAX_EXPORT_TEMP_ATTEMPTS {
        let mut temp_file_name = file_name.to_os_string();
        if attempt == 0 {
            temp_file_name.push(format!(".{nonce}.athenaeum-tmp"));
        } else {
            temp_file_name.push(format!(".{nonce}-{attempt}.athenaeum-tmp"));
        }
        let temp_path = destination.with_file_name(temp_file_name);

        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((file, temp_path)),
            // Nome ja em uso (orfao raro de execucao interrompida): tenta o proximo.
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Nao foi possivel criar o arquivo temporario de exportacao: {error}"
                ));
            }
        }
    }

    Err("Nao foi possivel criar um arquivo temporario exclusivo de exportacao.".to_string())
}

struct ExportDestinationBackup {
    directory: PathBuf,
    file: PathBuf,
}

fn export_backup_directory_path(destination: &Path, backup_token: &str, attempt: usize) -> PathBuf {
    destination.with_file_name(format!(".athenaeum-export-backup-{backup_token}-{attempt}"))
}

fn create_exclusive_export_backup(
    destination: &Path,
    file_name: &std::ffi::OsStr,
    backup_token: &str,
) -> Result<ExportDestinationBackup, String> {
    for attempt in 1..=MAX_EXPORT_BACKUP_ATTEMPTS {
        let backup_dir = export_backup_directory_path(destination, backup_token, attempt);

        match std::fs::create_dir(&backup_dir) {
            Ok(()) => {
                return Ok(ExportDestinationBackup {
                    file: backup_dir.join(file_name),
                    directory: backup_dir,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Nao foi possivel criar o diretorio de backup da exportacao: {error}"
                ));
            }
        }
    }

    Err("Nao foi possivel criar um backup exclusivo da exportacao.".to_string())
}

// Preserva o destino existente movendo-o para um diretorio exclusivo da
// propria operacao. O diretorio fica no mesmo pai do destino, e create_dir
// garante exclusividade sem depender de hard links (portavel para FAT/exFAT).
fn preserve_existing_export_destination(
    destination: &Path,
    file_name: &std::ffi::OsStr,
    backup_token: &str,
) -> Result<ExportDestinationBackup, String> {
    let backup = create_exclusive_export_backup(destination, file_name, backup_token)?;

    if let Err(error) = std::fs::rename(destination, &backup.file) {
        let _ = std::fs::remove_dir(&backup.directory);
        return Err(format!(
            "Nao foi possivel preservar o arquivo existente: {error}"
        ));
    }

    Ok(backup)
}

fn backup_cleanup_warning() -> NotebookExportRuntimeWarning {
    export_runtime_warning(
        EXPORT_WARNING_BACKUP_CLEANUP_FAILED,
        "HTML exportado, mas pode ter permanecido um residuo de recuperacao.",
    )
}

fn cleanup_export_backup_after_success(
    backup: &ExportDestinationBackup,
) -> Option<NotebookExportRuntimeWarning> {
    let mut failed = false;

    if std::fs::remove_file(&backup.file).is_err() {
        failed = true;
    }
    if std::fs::remove_dir(&backup.directory).is_err() {
        failed = true;
    }

    if failed {
        Some(backup_cleanup_warning())
    } else {
        None
    }
}

fn restore_export_backup_after_failed_promotion(
    backup: &ExportDestinationBackup,
    destination: &Path,
) -> Result<(), String> {
    if destination.exists() {
        return Err("o destino ja existe; o backup de recuperacao foi preservado".to_string());
    }

    std::fs::rename(&backup.file, destination)
        .map_err(|error| format!("nao foi possivel restaurar o arquivo anterior: {error}"))
}

// Durabilidade da ENTRADA de diretorio: apos o rename publicar o destino, um
// fsync no diretorio pai garante que a propria entrada (nome -> arquivo)
// sobreviva a uma queda de energia. Complementa o sync_all do temporario, que
// so garante o CONTEUDO: sem este, o destino poderia "existir" apos o boot mas
// a entrada de diretorio do rename ainda nao estar persistida. Em POSIX exige
// abrir e sincronizar o diretorio; no Windows nao ha equivalente direto via
// std (File::open falha em diretorio), entao e best-effort e vira no-op onde
// nao se aplica — o journal do NTFS cuida da ordem das operacoes de metadados.
fn sync_parent_directory(path: &Path) {
    if let Some(parent) = path.parent() {
        if let Ok(directory) = File::open(parent) {
            let _ = directory.sync_all();
        }
    }
}

// Finalizacao RECUPERAVEL da exportacao — extraida do comando para ser
// testavel com filesystem real. No Windows, rename falha se o destino existir;
// para sobrescrever sem depender de hard links, o arquivo antigo e movido para
// um diretorio exclusivo da operacao:
//   .athenaeum-export-backup-<nonce>-<tentativa>/<nome-original>
// A promocao do temporario continua sendo rename no mesmo diretorio pai. A
// sobrescrita e recuperavel, mas nao e descrita como atomicidade estrita no
// Windows: se a promocao falhar, tentamos restaurar somente o backup criado
// nesta operacao e preservamos esse backup quando a restauracao nao e
// confirmada.
fn finalize_notebook_export_file(
    temp_path: &Path,
    destination: &Path,
    backup_token: &str,
) -> Result<Vec<NotebookExportRuntimeWarning>, String> {
    let Some(file_name) = destination.file_name().map(|name| name.to_os_string()) else {
        let _ = std::fs::remove_file(temp_path);
        return Err("Destino de exportacao invalido.".to_string());
    };
    let mut backup: Option<ExportDestinationBackup> = None;

    if destination.exists() {
        let preserved_backup =
            preserve_existing_export_destination(destination, &file_name, backup_token)
                .inspect_err(|_| {
                    let _ = std::fs::remove_file(temp_path);
                })?;

        backup = Some(preserved_backup);
    }

    if let Err(error) = std::fs::rename(temp_path, destination) {
        let original_error = error.to_string();
        let rollback_error = if let Some(current_backup) = &backup {
            match restore_export_backup_after_failed_promotion(current_backup, destination) {
                Ok(()) => {
                    let _ = std::fs::remove_dir(&current_backup.directory);
                    None
                }
                Err(rollback_error) => Some(rollback_error),
            }
        } else {
            None
        };

        let _ = std::fs::remove_file(temp_path);

        if let Some(rollback_error) = rollback_error {
            return Err(format!(
        "Nao foi possivel finalizar a exportacao: {original_error}. Tambem nao foi possivel restaurar o arquivo anterior: {rollback_error}."
      ));
        }

        return Err(format!(
            "Nao foi possivel finalizar a exportacao: {original_error}"
        ));
    }

    // Destino recem-publicado pelo rename: persiste a entrada de diretorio para
    // ela sobreviver a uma queda. A limpeza do backup abaixo nunca reverte o
    // destino novo; falha de cleanup vira warning, nao erro fatal.
    sync_parent_directory(destination);

    let mut warnings = Vec::new();
    if let Some(current_backup) = backup {
        if let Some(warning) = cleanup_export_backup_after_success(&current_backup) {
            warnings.push(warning);
        }
    }

    Ok(warnings)
}

#[tauri::command]
async fn write_notebook_export<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db_instances: tauri::State<'_, DbInstances>,
    destinations: tauri::State<'_, NotebookExportDestinations>,
    destination_path: String,
    html: String,
    manifest: NotebookExportManifestInput,
) -> Result<NotebookExportWriteResult, String> {
    if html.is_empty() {
        return Err("HTML da exportacao vazio.".to_string());
    }

    // Contrato primeiro: manifest malformado (nonce/slots fora do padrao do
    // builder TS) aborta antes de qualquer I/O.
    validate_export_manifest(&manifest)?;

    // O destino vem do dialogo nativo de salvar (o usuario escolheu a pasta e o
    // nome). Nao restringimos a diretorios do app — exportar e justamente gravar
    // PARA FORA — mas exigimos caminho absoluto .html/.htm, com nome de arquivo
    // e pasta existente, e que nao aponte para um diretorio.
    let destination = PathBuf::from(&destination_path);
    validate_export_destination_shape(&destination)?;

    // Autorizacao: o caminho precisa ter saido do dialogo nativo NESTA sessao.
    // O lock e curto e nunca atravessa um await.
    {
        let authorized = destinations
            .0
            .lock()
            .map_err(|_| "Estado de exportacao indisponivel.".to_string())?;
        if !authorized.contains(&destination) {
            return Err("Destino de exportacao nao autorizado pelo usuario.".to_string());
        }
    }

    let Some(file_name) = destination.file_name().map(|name| name.to_os_string()) else {
        return Err("Destino de exportacao invalido.".to_string());
    };
    let parent_dir = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "Destino de exportacao invalido.".to_string())?;
    if !parent_dir.is_dir() {
        return Err("A pasta de destino nao existe.".to_string());
    }
    if destination.is_dir() {
        return Err("O destino da exportacao e um diretorio.".to_string());
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;

    let mut warnings: Vec<NotebookExportRuntimeWarning> = Vec::new();
    let page_ids: HashSet<i64> = manifest.page_ids.iter().copied().collect();

    // -----------------------------------------------------------------------
    // PASSO 1 — Resolver cada slot no banco (fonte de verdade de caminho, mime
    // e propriedade). O lock do banco e segurado SO aqui; a escrita do arquivo,
    // com I/O potencialmente longo, roda depois sem o lock.
    // -----------------------------------------------------------------------
    let mut resolved: std::collections::HashMap<String, ResolvedEmbed> =
        std::collections::HashMap::new();

    {
        let instances = db_instances.0.read().await;
        let pool = match instances.get(DATABASE_KEY) {
            Some(DbPool::Sqlite(pool)) => pool,
            _ => return Err("Banco de dados nao carregado.".to_string()),
        };

        for slot in &manifest.slots {
            // Id malformado nunca sai de um build correto (os ids vem de UUIDs reais
            // do DOM) — e adulteracao/bug, entao FATAL, nao degradacao.
            if validate_file_id(&slot.resource_id).is_err() {
                return Err(format!(
                    "Identificador de recurso invalido no manifest: slot {}.",
                    slot.slot_id
                ));
            }

            // Propriedade FATAL: um slot que referencia pagina fora do escopo
            // exportado nunca sai de um build correto. Abortar fecha o vazamento
            // (fail-closed), em vez de "concluir" com um placeholder no lugar.
            if !page_ids.contains(&slot.page_id) {
                return Err(format!(
                    "Recurso fora do escopo exportado: slot {}.",
                    slot.slot_id
                ));
            }

            match slot.kind.as_str() {
                "notebook-asset" => {
                    let row: Option<(String, String, String, String)> = sqlx::query_as(
            "SELECT notebook_id, page_id, mime_type, file_path FROM notebook_assets WHERE id = ?",
          )
          .bind(&slot.resource_id)
          .fetch_optional(pool)
          .await
          .map_err(|error| format!("Nao foi possivel resolver o asset do caderno: {error}"))?;

                    let Some((asset_notebook_id, asset_page_id, mime_type, file_path)) = row else {
                        warnings.push(export_slot_warning(
                            EXPORT_WARNING_MISSING_RESOURCE,
                            slot,
                            "Imagem do caderno nao encontrada.",
                        ));
                        continue;
                    };

                    // Propriedade FATAL: embutir uma imagem de OUTRO caderno/pagina
                    // vazaria conteudo alheio no export — abortar em vez de degradar.
                    if !export_owner_matches(
                        &asset_notebook_id,
                        &asset_page_id,
                        manifest.notebook_id,
                        slot.page_id,
                    ) {
                        return Err(format!(
                            "Imagem nao pertence ao caderno/pagina exportados: slot {}.",
                            slot.slot_id
                        ));
                    }

                    // MIME do asset vem do banco (nao do frontend), mas rechecamos a
                    // allowlist de imagem aqui: um asset so entra como <img src="data:...">
                    // se o MIME for realmente uma imagem suportada. Fora da lista =
                    // registro corrompido → degrada (recurso inutilizavel), nunca embute
                    // um data URI de imagem com tipo invalido.
                    if !is_supported_export_image_mime(&mime_type) {
                        warnings.push(export_slot_warning(
                            EXPORT_WARNING_INVALID_ASSET_MIME_TYPE,
                            slot,
                            "Tipo de imagem nao suportado na exportacao.",
                        ));
                        continue;
                    }

                    let Ok(absolute_path) = resolve_app_data_relative_path(&data_dir, &file_path)
                    else {
                        warnings.push(export_slot_warning(
                            EXPORT_WARNING_MISSING_RESOURCE,
                            slot,
                            "Caminho da imagem invalido.",
                        ));
                        continue;
                    };
                    if !absolute_path.is_file() {
                        warnings.push(export_slot_warning(
                            EXPORT_WARNING_MISSING_FILE,
                            slot,
                            "Arquivo da imagem ausente no disco.",
                        ));
                        continue;
                    }

                    resolved.insert(
                        slot.slot_id.clone(),
                        ResolvedEmbed::Asset {
                            path: absolute_path,
                            mime: sanitize_data_uri_mime(&mime_type),
                            alt: slot.alt_text.clone().unwrap_or_default(),
                        },
                    );
                }
                "notebook-attachment" => {
                    let row: Option<(i64, i64, Option<String>, String, String)> = sqlx::query_as(
                        "SELECT notebook_id, page_id, mime_type, file_path, original_name \
             FROM notebook_file_attachments WHERE id = ?",
                    )
                    .bind(&slot.resource_id)
                    .fetch_optional(pool)
                    .await
                    .map_err(|error| {
                        format!("Nao foi possivel resolver o anexo do caderno: {error}")
                    })?;

                    let Some((
                        attachment_notebook_id,
                        attachment_page_id,
                        mime_type,
                        file_path,
                        original_name,
                    )) = row
                    else {
                        warnings.push(export_slot_warning(
                            EXPORT_WARNING_MISSING_RESOURCE,
                            slot,
                            "Anexo do caderno nao encontrado.",
                        ));
                        continue;
                    };

                    // Propriedade FATAL: mesmo motivo do asset — anexo de outro caderno/
                    // pagina nao pode entrar no export.
                    if !export_owner_matches(
                        &attachment_notebook_id.to_string(),
                        &attachment_page_id.to_string(),
                        manifest.notebook_id,
                        slot.page_id,
                    ) {
                        return Err(format!(
                            "Anexo nao pertence ao caderno/pagina exportados: slot {}.",
                            slot.slot_id
                        ));
                    }

                    let Ok(absolute_path) = resolve_app_data_relative_path(&data_dir, &file_path)
                    else {
                        warnings.push(export_slot_warning(
                            EXPORT_WARNING_MISSING_RESOURCE,
                            slot,
                            "Caminho do anexo invalido.",
                        ));
                        continue;
                    };
                    if !absolute_path.is_file() {
                        warnings.push(export_slot_warning(
                            EXPORT_WARNING_MISSING_FILE,
                            slot,
                            "Arquivo do anexo ausente no disco.",
                        ));
                        continue;
                    }

                    let download_name = sanitize_attachment_file_name(&original_name)
                        .unwrap_or_else(|_| "arquivo".to_string());
                    let visible_name = slot
                        .display_name
                        .clone()
                        .map(|name| name.trim().to_string())
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| original_name.clone());
                    let (mime, mime_warning) =
                        resolve_attachment_export_mime(mime_type.as_deref(), slot);
                    if let Some(warning) = mime_warning {
                        warnings.push(warning);
                    }

                    resolved.insert(
                        slot.slot_id.clone(),
                        ResolvedEmbed::Attachment {
                            path: absolute_path,
                            mime,
                            download_name,
                            visible_name,
                        },
                    );
                }
                _ => {
                    // Inalcancavel: validate_export_manifest ja rejeita kind fora do
                    // contrato. Fatal por seguranca (defesa em profundidade), nunca
                    // degradacao silenciosa.
                    return Err(format!(
                        "Tipo de recurso invalido no manifest: {}.",
                        slot.kind
                    ));
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // PASSO 2 — Contrato FATAL: HTML e manifest tem de casar estruturalmente
    // ANTES de qualquer arquivo ser criado. Divergencia estrutural aborta aqui,
    // sem deixar temporario para tras.
    // -----------------------------------------------------------------------
    let sentinels = parse_export_slot_sentinels(&html);
    validate_export_html_against_manifest(&sentinels, &manifest)?;

    // -----------------------------------------------------------------------
    // PASSO 3 — Escrita ATOMICA: temporario + rename (mesmo padrao seguro dos
    // outros comandos). O corpo e escrito em stream, trocando cada sentinela
    // pelo recurso resolvido. Recurso individual ausente (ja avisado no PASSO 1)
    // vira placeholder visivel, sem abortar a exportacao inteira.
    //
    // Temporario EXCLUSIVO por export (nonce do manifest no nome + create_new):
    // dois exports simultaneos para o mesmo destino nao colidem, e um arquivo
    // real do usuario com o mesmo nome NUNCA e truncado.
    // -----------------------------------------------------------------------
    let (file, temp_path) =
        create_exclusive_export_temp(&destination, &file_name, &manifest.nonce)?;
    let mut writer = BufWriter::new(file);

    let mut embedded_assets = 0u32;
    let mut embedded_attachments = 0u32;
    let mut missing_resources = 0u32;

    let streaming: std::io::Result<()> = (|| {
        let mut cursor = 0usize;

        for sentinel in &sentinels {
            // Os offsets das sentinelas vem de `find` neste mesmo HTML, entao
            // sao fronteiras UTF-8 validas e a fatia de bytes preserva o texto.
            writer.write_all(&html.as_bytes()[cursor..sentinel.start])?;
            cursor = sentinel.end;

            // O contrato ja garantiu: nonce casa, o slot existe no manifest e nao ha
            // duplicata. Cada sentinela mapeia para exatamente um slot.
            match resolved.get(&sentinel.slot_id) {
                Some(ResolvedEmbed::Asset { path, mime, alt }) => {
                    write!(
                        writer,
                        "<img class=\"athenaeum-export__asset\" alt=\"{}\" src=\"",
                        escape_export_html(alt)
                    )?;
                    stream_embed_data_uri(&mut writer, path, mime)?;
                    writer.write_all(b"\">")?;
                    embedded_assets += 1;
                }
                Some(ResolvedEmbed::Attachment {
                    path,
                    mime,
                    download_name,
                    visible_name,
                }) => {
                    write!(
                        writer,
                        "<a class=\"athenaeum-export__attachment\" download=\"{}\" href=\"",
                        escape_export_html(download_name)
                    )?;
                    stream_embed_data_uri(&mut writer, path, mime)?;
                    write!(writer, "\">{}</a>", escape_export_html(visible_name))?;
                    embedded_attachments += 1;
                }
                None => {
                    // Slot valido que nao pode ser embutido — linha do banco inexistente,
                    // arquivo apagado do disco ou MIME de imagem fora da allowlist (todos
                    // ja avisados no PASSO 1). Propriedade e id invalido nao chegam aqui:
                    // sao fatais no PASSO 1.
                    write_missing_resource_placeholder(&mut writer)?;
                    missing_resources += 1;
                }
            }
        }

        writer.write_all(&html.as_bytes()[cursor..])?;
        writer.flush()?;
        Ok(())
    })();

    if let Err(error) = streaming {
        drop(writer);
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Nao foi possivel gravar a exportacao: {error}"));
    }

    // Fecha o writer (flush final do buffer para o File) e recupera o handle.
    let temp_file = match writer.into_inner() {
        Ok(file) => file,
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "Nao foi possivel finalizar o arquivo temporario: {}",
                error.error()
            ));
        }
    };

    // Durabilidade: forca os bytes para o disco ANTES do rename tornar o
    // temporario o arquivo oficial. Sem o fsync, uma queda de energia logo apos
    // o rename poderia deixar o destino EXISTINDO mas com conteudo nao gravado
    // (o rename e de metadados; os dados ainda poderiam estar so no cache do SO).
    if let Err(error) = temp_file.sync_all() {
        drop(temp_file);
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "Nao foi possivel sincronizar a exportacao no disco: {error}"
        ));
    }
    drop(temp_file);

    warnings.extend(finalize_notebook_export_file(
        &temp_path,
        &destination,
        &manifest.nonce,
    )?);

    // Autorizacao consumida: uma escolha no dialogo = uma escrita concluida.
    // Retentativas apos falha reutilizam a autorizacao (nada foi consumido);
    // um novo export passa pelo dialogo de novo.
    if let Ok(mut authorized) = destinations.0.lock() {
        authorized.remove(&destination);
    }

    let bytes_written = std::fs::metadata(&destination)
        .map(|metadata| metadata.len() as i64)
        .unwrap_or(0);

    Ok(NotebookExportWriteResult {
        path: destination.to_string_lossy().to_string(),
        bytes_written,
        embedded_assets,
        embedded_attachments,
        missing_resources,
        warnings,
    })
}

fn database_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_library_persistence_schema",
            sql: r#"
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  year INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in-progress', 'completed', 'not-started', 'error')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  collection_id TEXT NOT NULL,
  file_name TEXT,
  file_path TEXT,
  notes TEXT NOT NULL DEFAULT '',
  reading_location_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE document_authors (
  document_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_order INTEGER NOT NULL,
  PRIMARY KEY (document_id, author_order),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color_token TEXT NOT NULL CHECK (color_token IN ('violet', 'indigo', 'blue', 'teal', 'rose', 'amber')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE document_tags (
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  tag_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE documents_fts USING fts5(
  document_id UNINDEXED,
  title,
  authors,
  source,
  year,
  collection,
  tags,
  notes
);

CREATE INDEX idx_documents_collection_id ON documents(collection_id);
CREATE INDEX idx_documents_updated_at ON documents(updated_at);
CREATE INDEX idx_documents_favorite ON documents(favorite);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_document_tags_tag_id ON document_tags(tag_id);

CREATE TRIGGER collections_touch_updated_at
AFTER UPDATE ON collections
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE collections
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER documents_touch_updated_at
AFTER UPDATE ON documents
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE documents
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER tags_touch_updated_at
AFTER UPDATE ON tags
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE tags
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER documents_fts_after_document_insert
AFTER INSERT ON documents
FOR EACH ROW
BEGIN
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    NEW.id,
    NEW.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = NEW.id ORDER BY author_order), ''),
    NEW.source,
    CAST(NEW.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = NEW.id ORDER BY document_tags.tag_order), ''),
    NEW.notes
  FROM collections
  WHERE collections.id = NEW.collection_id;
END;

CREATE TRIGGER documents_fts_after_document_update
AFTER UPDATE ON documents
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    NEW.id,
    NEW.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = NEW.id ORDER BY author_order), ''),
    NEW.source,
    CAST(NEW.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = NEW.id ORDER BY document_tags.tag_order), ''),
    NEW.notes
  FROM collections
  WHERE collections.id = NEW.collection_id;
END;

CREATE TRIGGER documents_fts_after_document_delete
AFTER DELETE ON documents
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.id;
END;

CREATE TRIGGER documents_fts_after_author_insert
AFTER INSERT ON document_authors
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END;

CREATE TRIGGER documents_fts_after_author_update
AFTER UPDATE ON document_authors
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END;

CREATE TRIGGER documents_fts_after_author_delete
AFTER DELETE ON document_authors
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = OLD.document_id;
END;

CREATE TRIGGER documents_fts_after_document_tag_insert
AFTER INSERT ON document_tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END;

CREATE TRIGGER documents_fts_after_document_tag_update
AFTER UPDATE ON document_tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.document_id;
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END;

CREATE TRIGGER documents_fts_after_document_tag_delete
AFTER DELETE ON document_tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = OLD.document_id;
END;

CREATE TRIGGER documents_fts_after_tag_update
AFTER UPDATE ON tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts
  WHERE document_id IN (SELECT document_id FROM document_tags WHERE tag_id = NEW.id);
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id IN (SELECT document_id FROM document_tags WHERE tag_id = NEW.id);
END;

CREATE TRIGGER documents_fts_after_tag_delete
AFTER DELETE ON tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts
  WHERE document_id IN (SELECT document_id FROM document_tags WHERE tag_id = OLD.id);
END;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_document_trash_state",
            sql: r#"
ALTER TABLE documents ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at);
"#,
            kind: MigrationKind::Up,
        },
        // v3: tabela de anotacoes da tela de leitura (highlights + comentarios).
        //
        // Cada linha e uma anotacao ancorada a uma selecao de texto numa pagina.
        // Modelamos highlight e comentario na MESMA tabela: `note = ''` significa
        // highlight puro; `note <> ''` significa highlight com comentario.
        //
        // Decisao de confiabilidade (prioridade #1 do projeto): toda a geometria do
        // highlight fica em UMA coluna (`rects_json`), entao criar/editar/excluir uma
        // anotacao e sempre UM unico statement SQL. O SQLite garante atomicidade por
        // statement, logo nao precisamos de transacao multi-statement (que seria
        // insegura no pool de conexoes do plugin-sql).
        Migration {
            version: 3,
            description: "create_reading_annotations",
            sql: r#"
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  -- Pagina 1-based onde a anotacao vive. Uma selecao que cruza paginas vira
  -- uma anotacao por pagina (cada uma com seus proprios rects).
  page INTEGER NOT NULL CHECK (page >= 1),
  -- Cor do highlight. Por ora so 'amber' (unica cor validada em WCAG AA para
  -- este uso). Verde/Green fica reservado para status "concluido" e nao entra
  -- aqui. Extensao futura reaproveitaria violet/indigo/blue/teal/rose, que ja
  -- sao validados; nao inventar cores novas sem validar contraste.
  color TEXT NOT NULL DEFAULT 'amber' CHECK (color IN ('amber')),
  -- Texto exato selecionado: usado na lista do painel, no copiar, e como sinal
  -- de verificacao/fallback de re-ancoragem se o PDF mudar.
  selected_text TEXT NOT NULL,
  -- Comentario opcional do usuario. '' = highlight sem comentario.
  note TEXT NOT NULL DEFAULT '',
  -- Geometria: JSON com array de retangulos normalizados (fracoes 0..1 do
  -- tamanho da pagina renderizada), ex: [{"x":0.1,"y":0.2,"w":0.3,"h":0.02}].
  -- Normalizado para sobreviver a zoom, DPR e tamanho de janela.
  rects_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_annotations_document_id ON annotations(document_id);
CREATE INDEX idx_annotations_document_page ON annotations(document_id, page);

-- Mantem updated_at em dia em qualquer UPDATE que nao o altere explicitamente,
-- seguindo o mesmo padrao das outras tabelas.
CREATE TRIGGER annotations_touch_updated_at
AFTER UPDATE ON annotations
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE annotations
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_collection_descriptions",
            sql: r#"
ALTER TABLE collections ADD COLUMN description TEXT NOT NULL DEFAULT '';
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "remove_sample_library_items",
            sql: r#"
DELETE FROM documents
WHERE id IN (
  'attention-is-all-you-need',
  'survey-large-language-models',
  'designing-data-intensive-applications',
  'imagenet-deep-cnns',
  'concrete-problems-ai-safety',
  'deep-learning',
  'bert-pretraining',
  'raft-reliable-distributed-systems',
  'probabilistic-machine-learning',
  'alignment-problem',
  'damaged-import-transformers'
);

DELETE FROM collections
WHERE id IN (
  'machine-learning-papers',
  'engineering-books',
  'business-books',
  'psychology',
  'reading-queue',
  'lixeira'
)
AND NOT EXISTS (
  SELECT 1 FROM documents WHERE documents.collection_id = collections.id
);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "drop_collection_descriptions",
            sql: r#"
ALTER TABLE collections DROP COLUMN description;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create_default_collection",
            sql: r#"
INSERT OR IGNORE INTO collections (id, name, is_system)
SELECT 'sem-titulo', 'Sem título', 0
WHERE NOT EXISTS (
  SELECT 1 FROM collections WHERE is_system = 0
);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_reader_info_fields_and_annotation_colors",
            sql: r#"
ALTER TABLE documents ADD COLUMN time_spent_seconds INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS annotations_touch_updated_at;
DROP INDEX IF EXISTS idx_annotations_document_id;
DROP INDEX IF EXISTS idx_annotations_document_page;

CREATE TABLE annotations_new (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page >= 1),
  color TEXT NOT NULL DEFAULT 'amber',
  selected_text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  rects_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

INSERT INTO annotations_new (
  id,
  document_id,
  page,
  color,
  selected_text,
  note,
  rects_json,
  created_at,
  updated_at
)
SELECT
  id,
  document_id,
  page,
  color,
  selected_text,
  note,
  rects_json,
  created_at,
  updated_at
FROM annotations;

DROP TABLE annotations;
ALTER TABLE annotations_new RENAME TO annotations;

CREATE INDEX idx_annotations_document_id ON annotations(document_id);
CREATE INDEX idx_annotations_document_page ON annotations(document_id, page);

CREATE TRIGGER annotations_touch_updated_at
AFTER UPDATE ON annotations
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE annotations
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_collection_color_and_description",
            sql: include_str!("../migrations/0009_add_collection_color_and_description.sql"),
            kind: MigrationKind::Up,
        },
        // v10: Cadernos (notebooks + notebook_pages) e Quadros (canvases).
        // O SQL vive em arquivo separado (mesmo padrao da v9) e esta comentado
        // bloco a bloco la. Pontos-chave do design:
        //   - collection_id e TEXT (collections.id e slug textual, nao numero);
        //   - FK colecao -> caderno/quadro usa ON DELETE RESTRICT: excluir a
        //     colecao exige mover o conteudo para a colecao fallback antes
        //     (deleteCollection, em src/lib/database.ts, faz esse UPDATE);
        //   - FK caderno -> pagina usa ON DELETE CASCADE: pagina e parte do
        //     caderno, nao sobrevive sem ele.
        // CRUD de cadernos/paginas/quadros fica em TypeScript via plugin-sql
        // (mesmo padrao de annotations) — nenhum comando Rust novo.
        Migration {
            version: 10,
            description: "add_notebooks_and_canvases",
            sql: include_str!("../migrations/0010_add_notebooks_and_canvases.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add_notebook_description",
            sql: include_str!("../migrations/0011_add_notebook_description.sql"),
            kind: MigrationKind::Up,
        },
        // v12: conteudo dos Quadros (cena Excalidraw em canvases.content) + tabela
        // canvas_files (indice dos binarios em disco). O trigger de updated_at de
        // canvases ja existe desde a v10 — a v12 nao recria. SQL comentado no arquivo.
        Migration {
            version: 12,
            description: "add_canvas_content_and_files",
            sql: include_str!("../migrations/0012_add_canvas_content_and_files.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add_notebook_canvas_menu_state",
            sql: include_str!("../migrations/0013_add_notebook_canvas_menu_state.sql"),
            kind: MigrationKind::Up,
        },
        // v14: tabela app_settings (chave-valor) para preferencias globais do app.
        // O CRUD e feito em TypeScript via plugin-sql (mesmo padrao das outras
        // leituras/escritas simples); nenhum comando Rust novo — este bloco so
        // registra a migration.
        Migration {
            version: 14,
            description: "add_app_settings",
            sql: include_str!("../migrations/0014_add_app_settings.sql"),
            kind: MigrationKind::Up,
        },
        // v15: notebook_tags (mesmo vocabulario de tags dos documentos) e
        // notebook_linked_documents (PDFs vinculados a um caderno, N:N). CRUD em
        // TypeScript via plugin-sql; nenhum comando Rust novo. SQL comentado
        // bloco a bloco no arquivo.
        Migration {
            version: 15,
            description: "add_notebook_tags_and_linked_documents",
            sql: include_str!("../migrations/0015_add_notebook_tags_and_linked_documents.sql"),
            kind: MigrationKind::Up,
        },
        // v16: metadados editaveis do painel de Detalhes dos Cadernos
        // (status de leitura e autor/disciplina).
        Migration {
            version: 16,
            description: "add_notebook_details_metadata",
            sql: include_str!("../migrations/0016_add_notebook_details_metadata.sql"),
            kind: MigrationKind::Up,
        },
        // v17: indice dos binarios de paginas de Caderno. O editor ainda nao cola
        // imagens nesta fase; a tabela e os comandos Rust preparam a persistencia
        // em disco para evitar base64 dentro de notebook_pages.content.
        Migration {
            version: 17,
            description: "add_notebook_assets",
            sql: include_str!("../migrations/0017_add_notebook_assets.sql"),
            kind: MigrationKind::Up,
        },
        // v18: arquivos anexados a paginas de Caderno. O HTML salva apenas
        // data-notebook-attachment-id; metadados ficam no SQLite e bytes em disco.
        Migration {
            version: 18,
            description: "add_notebook_file_attachments",
            sql: include_str!("../migrations/0018_add_notebook_file_attachments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "add_document_details_metadata",
            sql: include_str!("../migrations/0019_add_document_details_metadata.sql"),
            kind: MigrationKind::Up,
        },
        // v20: cada anotacao passa a registrar como sua geometria deve ser
        // desenhada no PDF: preenchimento de marca-texto ou linha inferior.
        // O SQL fica em arquivo separado porque migrations novas seguem esse
        // padrao no projeto. `include_str!` inclui o texto no binario durante a
        // compilacao; a execucao continua sendo feita pelo tauri-plugin-sql, na
        // ordem numerica das versions, quando o aplicativo abre o banco.
        Migration {
            version: 20,
            description: "add_annotation_mark_style",
            sql: include_str!("../migrations/0020_add_annotation_mark_style.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "add_document_bookmarks",
            sql: include_str!("../migrations/0021_add_document_bookmarks.sql"),
            kind: MigrationKind::Up,
        },
        // v22: cada documento guarda se a lista de anotacoes deve mostrar todas
        // as paginas ou apenas a pagina atual. O DEFAULT `all` define o estado
        // inicial inclusive para documentos antigos. O CHECK e uma regra do
        // proprio SQLite: ele impede que qualquer caminho de escrita persista
        // um texto fora dos dois valores que o TypeScript sabe representar.
        Migration {
            version: 22,
            description: "add_document_annotations_filter_scope",
            sql: include_str!("../migrations/0022_add_document_annotations_filter_scope.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "add_document_reading_list_dismissed_at",
            sql: include_str!("../migrations/0023_add_document_reading_list_dismissed_at.sql"),
            kind: MigrationKind::Up,
        },
    ]
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
                .add_migrations("sqlite:athenaeum.db", database_migrations())
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
            import_wallpaper,
            delete_notebook_file_attachment,
            load_canvas_files,
            load_notebook_assets,
            load_notebook_file_attachments,
            open_document_externally,
            open_external_url,
            open_file_location,
            open_notebook_file_attachment,
            open_notebook_window,
            open_reader_panel_window,
            open_reader_window,
            read_pdf_file,
            remove_wallpaper,
            resolve_wallpaper_path,
            reveal_notebook_file_attachment,
            save_canvas_file,
            save_notebook_asset,
            save_notebook_file_attachment,
            select_notebook_export_destination,
            select_pdf_file,
            select_pdf_files,
            select_wallpaper_image,
            write_notebook_export
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

    #[test]
    fn parses_sentinels_in_order_with_offsets() {
        let html =
            "a<!--ATHENAEUM_SLOT:nonce-abc:slot-1-->b<!--ATHENAEUM_SLOT:nonce-abc:slot-2-->c";
        let sentinels = parse_export_slot_sentinels(html);

        assert_eq!(sentinels.len(), 2);
        assert_eq!(sentinels[0].nonce, "nonce-abc");
        assert_eq!(sentinels[0].slot_id, "slot-1");
        assert_eq!(sentinels[1].slot_id, "slot-2");
        // Os offsets devem recortar exatamente a sentinela.
        assert_eq!(
            &html[sentinels[0].start..sentinels[0].end],
            "<!--ATHENAEUM_SLOT:nonce-abc:slot-1-->"
        );
        assert_eq!(
            &html[sentinels[1].start..sentinels[1].end],
            "<!--ATHENAEUM_SLOT:nonce-abc:slot-2-->"
        );
    }

    #[test]
    fn ignores_text_without_sentinels() {
        assert!(parse_export_slot_sentinels("<p>sem sentinela</p>").is_empty());
        // Prefixo sem sufixo nao vira sentinela.
        assert!(parse_export_slot_sentinels("<!--ATHENAEUM_SLOT:incompleto").is_empty());
    }

    #[test]
    fn escapes_html_special_characters() {
        assert_eq!(
            escape_export_html("<b>\"a\" & 'b'>"),
            "&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&gt;"
        );
    }

    #[test]
    fn keeps_valid_mime_and_replaces_unsafe_ones() {
        assert_eq!(sanitize_data_uri_mime("image/png"), "image/png");
        assert_eq!(sanitize_data_uri_mime("  image/svg+xml  "), "image/svg+xml");
        // Aspas/espacos/formato invalido caem no octet-stream.
        assert_eq!(
            sanitize_data_uri_mime("image/png\" onerror=x"),
            "application/octet-stream"
        );
        assert_eq!(
            sanitize_data_uri_mime("sembarra"),
            "application/octet-stream"
        );
        assert_eq!(sanitize_data_uri_mime(""), "application/octet-stream");
    }

    #[test]
    fn image_mime_allowlist_is_closed() {
        // Os 4 tipos que o save aceita passam.
        assert!(is_supported_export_image_mime("image/png"));
        assert!(is_supported_export_image_mime("image/jpeg"));
        assert!(is_supported_export_image_mime("image/gif"));
        assert!(is_supported_export_image_mime("  image/webp  "));

        // Fora da allowlist (svg, tipos nao-imagem, vazio) sao rejeitados.
        assert!(!is_supported_export_image_mime("image/svg+xml"));
        assert!(!is_supported_export_image_mime("application/octet-stream"));
        assert!(!is_supported_export_image_mime("text/html"));
        assert!(!is_supported_export_image_mime(""));
    }

    #[test]
    fn exclusive_temp_never_truncates_a_preexisting_file() {
        let dir = filesystem_test_dir("temp-exclusivo");
        let destination = dir.join("caderno.html");
        // Um arquivo real do usuario ja ocupa o nome base do temporario.
        let base_temp = dir.join("caderno.html.nonce-abc-123.athenaeum-tmp");
        std::fs::write(&base_temp, b"nao pode ser truncado").unwrap();

        let (file, temp_path) = create_exclusive_export_temp(
            &destination,
            std::ffi::OsStr::new("caderno.html"),
            "nonce-abc-123",
        )
        .expect("deve criar um temporario alternativo");
        drop(file);

        // O preexistente ficou intacto; o temp criado usa outro nome (sufixo).
        assert_eq!(std::fs::read(&base_temp).unwrap(), b"nao pode ser truncado");
        assert_ne!(temp_path, base_temp);
        assert!(temp_path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_export_nonce_pattern() {
        assert!(validate_export_nonce("nonce-abc-123").is_ok());
        assert!(validate_export_nonce("3f2c9c1e-8f1a-4b7e-9d2a-1c2b3d4e5f6a").is_ok());
        // Curto demais, caractere fora do padrao, vazio.
        assert!(validate_export_nonce("curto").is_err());
        assert!(validate_export_nonce("nonce_com_underscore").is_err());
        assert!(validate_export_nonce("").is_err());
        assert!(validate_export_nonce(&"a".repeat(81)).is_err());
    }

    #[test]
    fn validates_export_slot_id_pattern() {
        assert!(validate_export_slot_id("slot-1").is_ok());
        assert!(validate_export_slot_id("slot-42").is_ok());
        assert!(validate_export_slot_id("slot-").is_err());
        assert!(validate_export_slot_id("slot-1a").is_err());
        assert!(validate_export_slot_id("outro-1").is_err());
        assert!(validate_export_slot_id("").is_err());
        assert!(validate_export_slot_id("slot-1234567890").is_err());
    }

    fn manifest_for_test(slots: Vec<NotebookExportSlotInput>) -> NotebookExportManifestInput {
        NotebookExportManifestInput {
            version: 1,
            nonce: "nonce-abc-123".to_string(),
            notebook_id: 7,
            notebook_title: "Caderno de teste".to_string(),
            scope: "full-notebook".to_string(),
            page_ids: vec![1, 2],
            created_at: "2026-07-08T00:00:00.000Z".to_string(),
            slots,
        }
    }

    fn slot_for_test(slot_id: &str) -> NotebookExportSlotInput {
        NotebookExportSlotInput {
            slot_id: slot_id.to_string(),
            kind: "notebook-asset".to_string(),
            resource_id: "asset-1".to_string(),
            page_id: 1,
            occurrence: 1,
            alt_text: None,
            caption: None,
            display_name: None,
        }
    }

    fn attachment_slot_for_test(slot_id: &str) -> NotebookExportSlotInput {
        let mut slot = slot_for_test(slot_id);
        slot.kind = "notebook-attachment".to_string();
        slot.resource_id = "attachment-1".to_string();
        slot
    }

    #[test]
    fn attachment_valid_mime_is_preserved_without_warning() {
        let slot = attachment_slot_for_test("slot-1");
        let (mime, warning) = resolve_attachment_export_mime(Some(" application/pdf "), &slot);

        assert_eq!(mime, "application/pdf");
        assert!(warning.is_none());
    }

    #[test]
    fn attachment_unknown_mime_uses_octet_stream_and_warns() {
        let slot = attachment_slot_for_test("slot-1");

        for mime_type in [
            None,
            Some(""),
            Some("   "),
            Some("text/html\" onclick=x"),
            Some("sembarra"),
        ] {
            let (mime, warning) = resolve_attachment_export_mime(mime_type, &slot);

            assert_eq!(mime, "application/octet-stream");
            let warning = warning.expect("mime desconhecido deve avisar");
            assert_eq!(warning.code, EXPORT_WARNING_UNKNOWN_ATTACHMENT_MIME_TYPE);
            assert_eq!(warning.slot_id.as_deref(), Some("slot-1"));
            assert_eq!(warning.page_id, Some(1));
            assert!(!warning.message.contains('\\'));
            assert!(!warning.message.contains("C:"));
        }
    }

    #[test]
    fn invalid_asset_mime_warning_uses_final_code() {
        let slot = slot_for_test("slot-1");
        let warning = export_slot_warning(
            EXPORT_WARNING_INVALID_ASSET_MIME_TYPE,
            &slot,
            "Tipo de imagem nao suportado na exportacao.",
        );

        assert_eq!(warning.code, "invalid-asset-mime-type");
    }

    #[test]
    fn validates_export_manifest_contract() {
        assert!(
            validate_export_manifest(&manifest_for_test(vec![slot_for_test("slot-1")])).is_ok()
        );

        let mut bad_nonce = manifest_for_test(vec![]);
        bad_nonce.nonce = "###".to_string();
        assert!(validate_export_manifest(&bad_nonce).is_err());

        let mut bad_notebook = manifest_for_test(vec![]);
        bad_notebook.notebook_id = 0;
        assert!(validate_export_manifest(&bad_notebook).is_err());

        let mut no_pages = manifest_for_test(vec![]);
        no_pages.page_ids.clear();
        assert!(validate_export_manifest(&no_pages).is_err());

        let mut bad_page = manifest_for_test(vec![]);
        bad_page.page_ids = vec![1, -2];
        assert!(validate_export_manifest(&bad_page).is_err());

        // Slot com id fora do padrao e slot duplicado sao violacoes de contrato.
        assert!(
            validate_export_manifest(&manifest_for_test(vec![slot_for_test("slot-x")])).is_err()
        );
        assert!(validate_export_manifest(&manifest_for_test(vec![
            slot_for_test("slot-1"),
            slot_for_test("slot-1"),
        ]))
        .is_err());
    }

    #[test]
    fn rejects_manifest_outside_the_closed_contract() {
        // Versao desconhecida.
        let mut wrong_version = manifest_for_test(vec![]);
        wrong_version.version = 2;
        assert!(validate_export_manifest(&wrong_version).is_err());

        // Escopo fora do conjunto fechado.
        let mut wrong_scope = manifest_for_test(vec![]);
        wrong_scope.scope = "everything".to_string();
        assert!(validate_export_manifest(&wrong_scope).is_err());

        // Data de criacao vazia.
        let mut empty_created_at = manifest_for_test(vec![]);
        empty_created_at.created_at = String::new();
        assert!(validate_export_manifest(&empty_created_at).is_err());

        // Kind desconhecido agora e violacao de contrato, nao degradacao.
        let mut unknown_kind_slot = slot_for_test("slot-1");
        unknown_kind_slot.kind = "notebook-widget".to_string();
        assert!(validate_export_manifest(&manifest_for_test(vec![unknown_kind_slot])).is_err());

        // Ocorrencia zero.
        let mut zero_occurrence_slot = slot_for_test("slot-1");
        zero_occurrence_slot.occurrence = 0;
        assert!(validate_export_manifest(&manifest_for_test(vec![zero_occurrence_slot])).is_err());
    }

    fn sentinel_for_test(nonce: &str, slot_id: &str) -> ParsedExportSentinel {
        ParsedExportSentinel {
            start: 0,
            end: 0,
            nonce: nonce.to_string(),
            slot_id: slot_id.to_string(),
        }
    }

    #[test]
    fn accepts_html_that_matches_manifest_one_to_one() {
        let manifest = manifest_for_test(vec![slot_for_test("slot-1"), slot_for_test("slot-2")]);
        let sentinels = vec![
            sentinel_for_test("nonce-abc-123", "slot-1"),
            sentinel_for_test("nonce-abc-123", "slot-2"),
        ];
        assert!(validate_export_html_against_manifest(&sentinels, &manifest).is_ok());
    }

    #[test]
    fn html_manifest_structural_mismatch_is_fatal() {
        let manifest = manifest_for_test(vec![slot_for_test("slot-1"), slot_for_test("slot-2")]);

        // Nonce divergente entre sentinela e manifest.
        let wrong_nonce = vec![
            sentinel_for_test("nonce-outro-9", "slot-1"),
            sentinel_for_test("nonce-abc-123", "slot-2"),
        ];
        assert!(validate_export_html_against_manifest(&wrong_nonce, &manifest).is_err());

        // Sentinela sem slot correspondente no manifest.
        let unknown_sentinel = vec![
            sentinel_for_test("nonce-abc-123", "slot-1"),
            sentinel_for_test("nonce-abc-123", "slot-2"),
            sentinel_for_test("nonce-abc-123", "slot-3"),
        ];
        assert!(validate_export_html_against_manifest(&unknown_sentinel, &manifest).is_err());

        // Sentinela duplicada.
        let duplicate = vec![
            sentinel_for_test("nonce-abc-123", "slot-1"),
            sentinel_for_test("nonce-abc-123", "slot-1"),
            sentinel_for_test("nonce-abc-123", "slot-2"),
        ];
        assert!(validate_export_html_against_manifest(&duplicate, &manifest).is_err());

        // Slot do manifest sem sentinela no HTML.
        let missing_sentinel = vec![sentinel_for_test("nonce-abc-123", "slot-1")];
        assert!(validate_export_html_against_manifest(&missing_sentinel, &manifest).is_err());
    }

    #[test]
    fn accepts_empty_html_and_empty_manifest() {
        // Export sem imagens/anexos: nenhuma sentinela, nenhum slot — valido.
        let manifest = manifest_for_test(vec![]);
        assert!(validate_export_html_against_manifest(&[], &manifest).is_ok());
    }

    #[test]
    fn resource_ownership_matches_only_same_notebook_and_page() {
        // Dono casa: mesmo caderno e mesma pagina.
        assert!(export_owner_matches("7", "1", 7, 1));

        // Caderno diferente (recurso de outro caderno) → nao casa.
        assert!(!export_owner_matches("8", "1", 7, 1));

        // Pagina diferente dentro do mesmo caderno → nao casa.
        assert!(!export_owner_matches("7", "2", 7, 1));

        // Texto nao numerico ou vazio nunca casa (fail-closed).
        assert!(!export_owner_matches("", "1", 7, 1));
        assert!(!export_owner_matches("sete", "1", 7, 1));

        // Sem zeros a esquerda: o frontend grava a forma canonica ("7", nao "07").
        assert!(!export_owner_matches("07", "1", 7, 1));
    }

    #[test]
    fn deserializing_manifest_rejects_unknown_fields() {
        // deny_unknown_fields: um campo extra e drift de contrato → erro.
        let json_with_extra_field = r#"{
      "version": 1,
      "nonce": "nonce-abc-123",
      "notebookId": 7,
      "notebookTitle": "Caderno",
      "scope": "full-notebook",
      "pageIds": [1],
      "createdAt": "2026-07-08T00:00:00.000Z",
      "slots": [],
      "extraField": true
    }"#;
        assert!(
            serde_json::from_str::<NotebookExportManifestInput>(json_with_extra_field).is_err()
        );

        let valid_json = r#"{
      "version": 1,
      "nonce": "nonce-abc-123",
      "notebookId": 7,
      "notebookTitle": "Caderno",
      "scope": "full-notebook",
      "pageIds": [1],
      "createdAt": "2026-07-08T00:00:00.000Z",
      "slots": [{
        "slotId": "slot-1",
        "kind": "notebook-asset",
        "resourceId": "asset-1",
        "pageId": 1,
        "occurrence": 1,
        "altText": "desc"
      }]
    }"#;
        let parsed = serde_json::from_str::<NotebookExportManifestInput>(valid_json)
            .expect("manifest valido deve desserializar");
        assert!(validate_export_manifest(&parsed).is_ok());
    }

    // Diretorio temporario proprio por teste de filesystem, limpo antes e
    // depois, para os testes nao interferirem entre si nem entre execucoes.
    fn filesystem_test_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("athenaeum-export-fs-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("criar diretorio de teste");
        dir
    }

    #[test]
    fn finalizes_new_export_file() {
        let dir = filesystem_test_dir("novo");
        let temp = dir.join("caderno.html.nonce-abc-123.athenaeum-tmp");
        let destination = dir.join("caderno.html");
        std::fs::write(&temp, b"<html>novo</html>").unwrap();

        let warnings = finalize_notebook_export_file(&temp, &destination, "nonce-abc-123")
            .expect("finalizacao deve funcionar");

        assert!(warnings.is_empty());
        assert_eq!(std::fs::read(&destination).unwrap(), b"<html>novo</html>");
        assert!(!temp.exists());
        assert!(!dir
            .join(".athenaeum-export-backup-nonce-abc-123-1")
            .exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn replaces_existing_export_and_discards_backup() {
        let dir = filesystem_test_dir("sobrescrita");
        let temp = dir.join("caderno.html.nonce-abc-123.athenaeum-tmp");
        let destination = dir.join("caderno.html");
        std::fs::write(&destination, b"<html>antigo</html>").unwrap();
        std::fs::write(&temp, b"<html>novo</html>").unwrap();

        let warnings = finalize_notebook_export_file(&temp, &destination, "nonce-abc-123")
            .expect("sobrescrita deve funcionar");

        assert!(warnings.is_empty());
        assert_eq!(std::fs::read(&destination).unwrap(), b"<html>novo</html>");
        assert!(!temp.exists());
        // Backup exclusivo descartado apos a troca bem-sucedida.
        assert!(!dir
            .join(".athenaeum-export-backup-nonce-abc-123-1")
            .exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_uses_exclusive_directory_and_preserves_existing_candidate() {
        let dir = filesystem_test_dir("bak-dir-exclusivo");
        let temp = dir.join("caderno.html.nonce-abc-123.athenaeum-tmp");
        let destination = dir.join("caderno.html");
        let stale_backup_dir = dir.join(".athenaeum-export-backup-nonce-abc-123-1");
        std::fs::create_dir(&stale_backup_dir).unwrap();
        std::fs::write(stale_backup_dir.join("marcador.txt"), b"backup antigo").unwrap();
        std::fs::write(&destination, b"<html>antigo</html>").unwrap();
        std::fs::write(&temp, b"<html>novo</html>").unwrap();

        let warnings = finalize_notebook_export_file(&temp, &destination, "nonce-abc-123")
            .expect("deve usar outro diretorio de backup");

        assert!(warnings.is_empty());
        assert_eq!(std::fs::read(&destination).unwrap(), b"<html>novo</html>");
        assert_eq!(
            std::fs::read(stale_backup_dir.join("marcador.txt")).unwrap(),
            b"backup antigo"
        );
        assert!(!dir
            .join(".athenaeum-export-backup-nonce-abc-123-2")
            .exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_operations_with_same_destination_and_nonce_get_distinct_backup_directories() {
        let dir = filesystem_test_dir("bak-duplo");
        let destination = dir.join("caderno.html");
        std::fs::write(&destination, b"<html>antigo</html>").unwrap();

        let first = create_exclusive_export_backup(
            &destination,
            std::ffi::OsStr::new("caderno.html"),
            "nonce-abc-123",
        )
        .expect("primeiro backup");
        let second = create_exclusive_export_backup(
            &destination,
            std::ffi::OsStr::new("caderno.html"),
            "nonce-abc-123",
        )
        .expect("segundo backup");

        assert_ne!(first.directory, second.directory);
        assert!(first
            .directory
            .ends_with(".athenaeum-export-backup-nonce-abc-123-1"));
        assert!(second
            .directory
            .ends_with(".athenaeum-export-backup-nonce-abc-123-2"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restores_original_when_temp_is_missing() {
        let dir = filesystem_test_dir("restauracao");
        let temp = dir.join("caderno.html.nonce-abc-123.athenaeum-tmp"); // nunca criado
        let destination = dir.join("caderno.html");
        std::fs::write(&destination, b"<html>antigo</html>").unwrap();

        let result = finalize_notebook_export_file(&temp, &destination, "nonce-abc-123");

        assert!(result.is_err());
        // O rename do temp falhou DEPOIS do original virar backup; a restauracao
        // devolve o original ao lugar — o arquivo do usuario nunca se perde.
        assert_eq!(std::fs::read(&destination).unwrap(), b"<html>antigo</html>");
        assert!(!dir
            .join(".athenaeum-export-backup-nonce-abc-123-1")
            .exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rollback_failure_keeps_the_current_backup() {
        let dir = filesystem_test_dir("restauracao-falha");
        let destination = dir.join("caderno.html");
        let backup = create_exclusive_export_backup(
            &destination,
            std::ffi::OsStr::new("caderno.html"),
            "nonce-abc-123",
        )
        .expect("backup exclusivo");
        std::fs::write(&backup.file, b"<html>antigo</html>").unwrap();
        std::fs::write(
            &destination,
            b"<html>arquivo criado por outro processo</html>",
        )
        .unwrap();

        let result = restore_export_backup_after_failed_promotion(&backup, &destination);

        assert!(result.is_err());
        assert_eq!(std::fs::read(&backup.file).unwrap(), b"<html>antigo</html>");
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"<html>arquivo criado por outro processo</html>"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restores_original_without_removing_unrelated_old_backup() {
        let dir = filesystem_test_dir("restauracao-bak-existente");
        let temp = dir.join("caderno.html.nonce-abc-123.athenaeum-tmp"); // nunca criado
        let destination = dir.join("caderno.html");
        let stale_backup_dir = dir.join(".athenaeum-export-backup-nonce-abc-123-1");
        std::fs::create_dir(&stale_backup_dir).unwrap();
        std::fs::write(
            stale_backup_dir.join("caderno.html"),
            b"<html>bak anterior</html>",
        )
        .unwrap();
        std::fs::write(&destination, b"<html>antigo</html>").unwrap();

        let result = finalize_notebook_export_file(&temp, &destination, "nonce-abc-123");

        assert!(result.is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"<html>antigo</html>");
        assert_eq!(
            std::fs::read(stale_backup_dir.join("caderno.html")).unwrap(),
            b"<html>bak anterior</html>"
        );
        assert!(!dir
            .join(".athenaeum-export-backup-nonce-abc-123-2")
            .exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn successful_backup_cleanup_returns_no_warning() {
        let dir = filesystem_test_dir("cleanup-ok");
        let backup = ExportDestinationBackup {
            directory: dir.join(".athenaeum-export-backup-nonce-abc-123-1"),
            file: dir
                .join(".athenaeum-export-backup-nonce-abc-123-1")
                .join("caderno.html"),
        };
        std::fs::create_dir(&backup.directory).unwrap();
        std::fs::write(&backup.file, b"<html>antigo</html>").unwrap();

        let warning = cleanup_export_backup_after_success(&backup);

        assert!(warning.is_none());
        assert!(!backup.directory.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_backup_cleanup_warns_and_preserves_new_destination() {
        let dir = filesystem_test_dir("cleanup-falha");
        let destination = dir.join("caderno.html");
        std::fs::write(&destination, b"<html>novo</html>").unwrap();
        let backup = ExportDestinationBackup {
            directory: dir.join(".athenaeum-export-backup-nonce-abc-123-1"),
            file: dir
                .join(".athenaeum-export-backup-nonce-abc-123-1")
                .join("caderno.html"),
        };
        std::fs::create_dir(&backup.directory).unwrap();
        std::fs::write(&backup.file, b"<html>antigo</html>").unwrap();
        std::fs::write(backup.directory.join("residuo.txt"), b"bloqueia remove_dir").unwrap();

        let warning = cleanup_export_backup_after_success(&backup).expect("cleanup deve avisar");

        assert_eq!(warning.code, EXPORT_WARNING_BACKUP_CLEANUP_FAILED);
        assert!(warning.slot_id.is_none());
        assert!(warning.page_id.is_none());
        assert!(!warning.message.contains(dir.to_string_lossy().as_ref()));
        assert_eq!(std::fs::read(&destination).unwrap(), b"<html>novo</html>");
        assert!(backup.directory.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_export_destination_shape() {
        let absolute_html = if cfg!(windows) {
            PathBuf::from("C:\\exportacoes\\caderno.html")
        } else {
            PathBuf::from("/exportacoes/caderno.html")
        };
        assert!(validate_export_destination_shape(&absolute_html).is_ok());

        let absolute_htm_uppercase = if cfg!(windows) {
            PathBuf::from("C:\\exportacoes\\caderno.HTM")
        } else {
            PathBuf::from("/exportacoes/caderno.HTM")
        };
        assert!(validate_export_destination_shape(&absolute_htm_uppercase).is_ok());

        // Relativo, extensao errada e sem extensao sao rejeitados.
        assert!(validate_export_destination_shape(Path::new("caderno.html")).is_err());
        let wrong_extension = if cfg!(windows) {
            PathBuf::from("C:\\exportacoes\\caderno.exe")
        } else {
            PathBuf::from("/exportacoes/caderno.exe")
        };
        assert!(validate_export_destination_shape(&wrong_extension).is_err());
        let no_extension = if cfg!(windows) {
            PathBuf::from("C:\\exportacoes\\caderno")
        } else {
            PathBuf::from("/exportacoes/caderno")
        };
        assert!(validate_export_destination_shape(&no_extension).is_err());
    }

    #[test]
    fn streams_base64_data_uri_from_bytes() {
        // Confirma que o embed em stream produz o mesmo base64 de uma codificacao
        // direta (sem materializar a string inteira no meio do caminho).
        let mut temp = std::env::temp_dir();
        temp.push(format!("athenaeum-export-test-{}.bin", std::process::id()));
        std::fs::write(&temp, b"hello athenaeum export").unwrap();

        let mut buffer: Vec<u8> = Vec::new();
        stream_embed_data_uri(&mut buffer, &temp, "text/plain").unwrap();
        let _ = std::fs::remove_file(&temp);

        let expected = format!(
            "data:text/plain;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(b"hello athenaeum export")
        );
        assert_eq!(String::from_utf8(buffer).unwrap(), expected);
    }

    // -----------------------------------------------------------------------
    // Wallpaper
    // -----------------------------------------------------------------------

    fn wallpaper_test_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("athenaeum-wallpaper-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("criar diretorio de teste");
        dir
    }

    fn png_bytes() -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"corpo png de teste");
        bytes
    }

    fn jpeg_bytes() -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
        bytes.extend_from_slice(b"corpo jpeg de teste");
        bytes
    }

    fn webp_bytes() -> Vec<u8> {
        let mut bytes = Vec::from(*b"RIFF");
        bytes.extend_from_slice(&[0x1A, 0x00, 0x00, 0x00]);
        bytes.extend_from_slice(b"WEBP");
        bytes.extend_from_slice(b"VP8 corpo de teste");
        bytes
    }

    fn wallpaper_files_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .expect("listar pasta de wallpaper")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn accepts_only_the_three_wallpaper_formats_by_content() {
        assert_eq!(detect_wallpaper_extension(&png_bytes()), Ok("png"));
        assert_eq!(detect_wallpaper_extension(&jpeg_bytes()), Ok("jpg"));
        assert_eq!(detect_wallpaper_extension(&webp_bytes()), Ok("webp"));

        // Formatos de imagem fora da allowlist e conteudo que nem imagem e.
        assert!(detect_wallpaper_extension(b"GIF89a...........").is_err());
        assert!(detect_wallpaper_extension(b"<svg xmlns=\"http").is_err());
        assert!(detect_wallpaper_extension(b"%PDF-1.7........").is_err());
        assert!(detect_wallpaper_extension(b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00").is_err());
        assert!(detect_wallpaper_extension(b"").is_err());

        // RIFF sem WEBP no offset 8 (um .wav, por exemplo) nao passa.
        let mut riff_wave = Vec::from(*b"RIFF");
        riff_wave.extend_from_slice(&[0x1A, 0x00, 0x00, 0x00]);
        riff_wave.extend_from_slice(b"WAVE");
        assert!(detect_wallpaper_extension(&riff_wave).is_err());

        // Cabecalho truncado nao pode ser aceito por acidente nem entrar em
        // panico ao fatiar.
        assert!(detect_wallpaper_extension(&png_bytes()[..4]).is_err());
        assert!(detect_wallpaper_extension(&webp_bytes()[..6]).is_err());
    }

    #[test]
    fn rejects_a_non_image_disguised_by_the_file_extension() {
        let dir = wallpaper_test_dir("extensao-mentirosa");
        let source = dir.join("origem.png");
        std::fs::write(&source, b"GIF89a nao sou um png").unwrap();
        let wallpaper_dir = dir.join("wallpaper");

        let result = import_wallpaper_file(&wallpaper_dir, &source);

        assert!(result.is_err());
        // Nada foi promovido nem deixado para tras na pasta do app.
        assert!(!wallpaper_dir.exists() || wallpaper_files_in(&wallpaper_dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stores_the_extension_that_the_content_says_not_the_source_name() {
        let dir = wallpaper_test_dir("extensao-derivada");
        let source = dir.join("foto.png");
        std::fs::write(&source, jpeg_bytes()).unwrap();
        let wallpaper_dir = dir.join("wallpaper");

        let (file_name, _) = import_wallpaper_file(&wallpaper_dir, &source).expect("importar");

        assert!(file_name.ends_with(".jpg"), "nome gravado: {file_name}");
        assert_eq!(wallpaper_files_in(&wallpaper_dir), vec![file_name]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_source_over_the_size_limit_before_reading_it() {
        let dir = wallpaper_test_dir("limite-tamanho");
        let source = dir.join("gigante.png");
        // set_len em vez de gravar 16MB: o pre-check olha o metadata, entao o
        // teste nao precisa materializar os bytes.
        let file = File::create(&source).unwrap();
        file.set_len(MAX_WALLPAPER_BYTES + 1).unwrap();
        drop(file);
        let wallpaper_dir = dir.join("wallpaper");

        let error = import_wallpaper_file(&wallpaper_dir, &source).expect_err("deve recusar");

        assert!(error.contains("16MB"), "mensagem: {error}");
        assert!(!wallpaper_dir.exists() || wallpaper_files_in(&wallpaper_dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stops_copying_when_the_source_grows_past_the_limit() {
        // O pre-check de metadata nao basta: entre o metadata e a leitura o
        // arquivo pode crescer. Aqui a origem e infinita, simulando o pior caso.
        let dir = wallpaper_test_dir("limite-copia");
        let temp_path = dir.join("wallpaper-1.png.tmp");
        let header = png_bytes();
        let mut endless = std::io::repeat(0x5A);

        let error =
            write_wallpaper_temp(&temp_path, &header[..8], &mut endless).expect_err("deve recusar");

        assert!(error.contains("16MB"), "mensagem: {error}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_wallpaper_file_names_that_could_escape_the_folder() {
        assert!(validate_wallpaper_file_name("wallpaper-1755648000.png").is_ok());
        assert!(validate_wallpaper_file_name("wallpaper-1755648000.jpg").is_ok());
        assert!(validate_wallpaper_file_name("wallpaper-1755648000.webp").is_ok());

        // Traversal em todas as formas que chegariam pelo banco.
        assert!(validate_wallpaper_file_name("../wallpaper-1.png").is_err());
        assert!(validate_wallpaper_file_name("..\\wallpaper-1.png").is_err());
        assert!(validate_wallpaper_file_name("sub/wallpaper-1.png").is_err());
        assert!(
            validate_wallpaper_file_name("../../../../windows/system32/config/sam.png").is_err()
        );
        assert!(validate_wallpaper_file_name("C:\\Windows\\win.png").is_err());
        assert!(validate_wallpaper_file_name("/etc/passwd.png").is_err());
        assert!(validate_wallpaper_file_name("\\\\servidor\\share\\x.png").is_err());

        // Extensao fora da allowlist, sem extensao, e nome longo demais.
        assert!(validate_wallpaper_file_name("wallpaper-1.svg").is_err());
        assert!(validate_wallpaper_file_name("wallpaper-1.exe").is_err());
        assert!(validate_wallpaper_file_name("wallpaper-1").is_err());
        assert!(validate_wallpaper_file_name(".png").is_err());
        assert!(validate_wallpaper_file_name(&format!("{}.png", "a".repeat(65))).is_err());

        // Nome com caractere fora do conjunto gerado pelo import.
        assert!(validate_wallpaper_file_name("wallpaper 1.png").is_err());
        assert!(validate_wallpaper_file_name("wallpaper_1.png").is_err());
        assert!(validate_wallpaper_file_name("WALLPAPER-1.png").is_err());
    }

    #[test]
    fn resolves_only_files_inside_the_wallpaper_folder() {
        let dir = wallpaper_test_dir("resolucao");
        let wallpaper_dir = dir.join("wallpaper");
        std::fs::create_dir_all(&wallpaper_dir).unwrap();
        std::fs::write(wallpaper_dir.join("wallpaper-1.png"), png_bytes()).unwrap();
        // Vizinho fora da pasta, alvo natural de um traversal.
        std::fs::write(dir.join("segredo.png"), png_bytes()).unwrap();

        let resolved = resolve_wallpaper_file(&wallpaper_dir, "wallpaper-1.png").expect("resolver");
        assert_eq!(resolved, wallpaper_dir.join("wallpaper-1.png"));
        // Caminho devolvido nao vem canonicalizado (sem prefixo \\?\ no Windows).
        assert!(!resolved.to_string_lossy().starts_with("\\\\?\\"));

        assert!(resolve_wallpaper_file(&wallpaper_dir, "../segredo.png").is_err());
        assert!(resolve_wallpaper_file(&wallpaper_dir, "wallpaper-2.png").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn swapping_the_wallpaper_deletes_the_previous_file() {
        let dir = wallpaper_test_dir("troca");
        let wallpaper_dir = dir.join("wallpaper");
        let first_source = dir.join("primeira.png");
        std::fs::write(&first_source, png_bytes()).unwrap();
        let second_source = dir.join("segunda.jpg");
        std::fs::write(&second_source, jpeg_bytes()).unwrap();

        let (first_name, _) = import_wallpaper_file(&wallpaper_dir, &first_source).expect("1a");
        assert_eq!(wallpaper_files_in(&wallpaper_dir), vec![first_name.clone()]);

        let (second_name, _) = import_wallpaper_file(&wallpaper_dir, &second_source).expect("2a");

        assert_ne!(first_name, second_name);
        assert!(!wallpaper_dir.join(&first_name).exists());
        assert_eq!(wallpaper_files_in(&wallpaper_dir), vec![second_name]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn importing_sweeps_orphan_temporaries_left_by_a_crash() {
        let dir = wallpaper_test_dir("orfaos");
        let wallpaper_dir = dir.join("wallpaper");
        std::fs::create_dir_all(&wallpaper_dir).unwrap();
        // Exatamente o que um kill no meio da escrita deixaria: o temporario,
        // nunca o nome definitivo truncado.
        std::fs::write(wallpaper_dir.join("wallpaper-1.png.tmp"), b"pela metade").unwrap();
        let source = dir.join("nova.png");
        std::fs::write(&source, png_bytes()).unwrap();

        let (file_name, _) = import_wallpaper_file(&wallpaper_dir, &source).expect("importar");

        assert_eq!(wallpaper_files_in(&wallpaper_dir), vec![file_name]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn removing_the_wallpaper_empties_the_folder() {
        let dir = wallpaper_test_dir("remocao");
        let wallpaper_dir = dir.join("wallpaper");
        let source = dir.join("origem.webp");
        std::fs::write(&source, webp_bytes()).unwrap();
        import_wallpaper_file(&wallpaper_dir, &source).expect("importar");
        assert_eq!(wallpaper_files_in(&wallpaper_dir).len(), 1);

        sweep_wallpaper_directory(&wallpaper_dir, None);

        assert!(wallpaper_files_in(&wallpaper_dir).is_empty());
        // A origem escolhida pelo usuario continua onde estava: o app copia,
        // nao move.
        assert!(source.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sweeping_a_missing_folder_is_not_an_error() {
        let dir = wallpaper_test_dir("pasta-ausente");
        sweep_wallpaper_directory(&dir.join("wallpaper"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn imported_wallpaper_keeps_the_original_bytes() {
        let dir = wallpaper_test_dir("bytes");
        let wallpaper_dir = dir.join("wallpaper");
        let source = dir.join("origem.webp");
        let bytes = webp_bytes();
        std::fs::write(&source, &bytes).unwrap();

        let (file_name, written) =
            import_wallpaper_file(&wallpaper_dir, &source).expect("importar");

        // O cabecalho lido para farejar o formato precisa voltar para o arquivo
        // final: se ele fosse consumido e nao regravado, o destino sairia com os
        // 12 primeiros bytes faltando.
        assert_eq!(
            std::fs::read(wallpaper_dir.join(&file_name)).unwrap(),
            bytes
        );
        assert_eq!(written, bytes.len() as u64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_an_empty_source_file() {
        let dir = wallpaper_test_dir("vazio");
        let source = dir.join("vazia.png");
        std::fs::write(&source, b"").unwrap();
        let wallpaper_dir = dir.join("wallpaper");

        let error = import_wallpaper_file(&wallpaper_dir, &source).expect_err("deve recusar");

        // A mensagem importa: um arquivo vazio tambem cairia no farejador de
        // conteudo, mas "formato nao suportado" mandaria o usuario procurar
        // problema no formato de um arquivo que so esta vazio.
        assert!(error.contains("vazia"), "mensagem: {error}");
        assert!(!wallpaper_dir.exists() || wallpaper_files_in(&wallpaper_dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // Cadeia de migrations
    // -----------------------------------------------------------------------

    use sqlx::error::BoxDynError;
    use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
    use std::borrow::Cow;
    use std::future::Future;
    use std::pin::Pin;

    // Espelha a conversao feita pelo `MigrationList` do tauri-plugin-sql, que e
    // privado e por isso nao pode ser reaproveitado daqui: `MigrationKind::Up`
    // vira `MigrationType::ReversibleUp`, `no_tx` e sempre `false`, e migrations
    // `Down` sao descartadas. Se o plugin mudar essa conversao numa versao
    // futura, este helper precisa acompanhar — senao os testes abaixo passam a
    // exercitar uma cadeia que nao e mais a que roda em producao.
    fn to_sqlx_migrations(migrations: Vec<Migration>) -> Vec<SqlxMigration> {
        migrations
            .into_iter()
            .filter(|migration| matches!(migration.kind, MigrationKind::Up))
            .map(|migration| {
                SqlxMigration::new(
                    migration.version,
                    Cow::Borrowed(migration.description),
                    MigrationType::ReversibleUp,
                    Cow::Borrowed(migration.sql),
                    false,
                )
            })
            .collect()
    }

    // `MigrationSource` nao e implementado para `Vec<Migration>` no sqlx, e o
    // unico construtor publico de `Migrator` exige uma fonte. Este newtype so
    // devolve a lista ja convertida.
    #[derive(Debug)]
    struct ChainMigrationSource(Vec<SqlxMigration>);

    impl MigrationSource<'static> for ChainMigrationSource {
        fn resolve(
            self,
        ) -> Pin<Box<dyn Future<Output = Result<Vec<SqlxMigration>, BoxDynError>> + Send + 'static>>
        {
            Box::pin(async move { Ok(self.0) })
        }
    }

    async fn migration_chain_migrator() -> Migrator {
        Migrator::new(ChainMigrationSource(to_sqlx_migrations(
            database_migrations(),
        )))
        .await
        .expect("resolver a lista de migrations de producao")
    }

    fn migration_test_db_path(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "athenaeum-migrations-{}-{name}.db",
            std::process::id()
        ));
        remove_migration_test_db(&path);
        path
    }

    // O sqlx abre o SQLite em WAL por padrao, entao sobram `-wal` e `-shm` ao
    // lado do arquivo principal.
    fn remove_migration_test_db(path: &Path) {
        for suffix in ["", "-wal", "-shm"] {
            let mut candidate = path.as_os_str().to_os_string();
            candidate.push(suffix);
            let _ = std::fs::remove_file(PathBuf::from(candidate));
        }
    }

    // Banco em arquivo, nao `:memory:`: e o que se parece com producao, e as
    // tabelas-sombra do FTS5 podem se comportar diferente em memoria.
    async fn open_migration_test_pool(path: &Path) -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        SqlitePool::connect_with(options)
            .await
            .expect("abrir o banco temporario de teste")
    }

    // Fecha o pool antes de apagar: no Windows o arquivo continua travado
    // enquanto houver conexao aberta.
    async fn close_migration_test_pool(pool: SqlitePool, path: &Path) {
        pool.close().await;
        remove_migration_test_db(path);
    }

    #[tokio::test]
    async fn applies_the_whole_migration_chain_to_an_empty_database() {
        let path = migration_test_db_path("chain");
        let pool = open_migration_test_pool(&path).await;

        let outcome = migration_chain_migrator().await.run(&pool).await;

        // Le `_sqlx_migrations` antes de fechar o pool; se a cadeia falhou nao
        // ha o que ler, e o erro original vai no panic depois da limpeza, para
        // que o arquivo temporario nao sobreviva a uma falha.
        let applied = match outcome {
            Ok(()) => {
                let last: i64 = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
                    .fetch_one(&pool)
                    .await
                    .expect("ler a ultima versao aplicada em _sqlx_migrations");
                let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
                    .fetch_one(&pool)
                    .await
                    .expect("contar as migrations aplicadas");
                Ok((last, count))
            }
            Err(error) => Err(error),
        };

        close_migration_test_pool(pool, &path).await;

        let (applied_last, applied_count) = match applied {
            Ok(values) => values,
            Err(error) => {
                panic!("a cadeia completa de migrations falhou num banco vazio: {error}")
            }
        };

        let migrations = database_migrations();
        let expected_last = migrations
            .iter()
            .map(|migration| migration.version)
            .max()
            .expect("a lista de migrations nao pode estar vazia");

        assert_eq!(
            applied_last, expected_last,
            "a ultima migration aplicada deveria ser a v{expected_last}"
        );
        assert_eq!(
            applied_count,
            migrations.len() as i64,
            "todas as {} migrations declaradas deveriam ter sido aplicadas",
            migrations.len()
        );
    }

    #[test]
    fn migration_versions_are_sequential_and_descriptions_unique() {
        let migrations = database_migrations();
        assert!(
            !migrations.is_empty(),
            "a lista de migrations nao pode estar vazia"
        );

        let mut seen_descriptions: HashMap<&str, i64> = HashMap::new();
        for (index, migration) in migrations.iter().enumerate() {
            let expected_version = index as i64 + 1;
            assert_eq!(
                migration.version, expected_version,
                "a migration na posicao {index} declara v{} (\"{}\"), mas as versoes precisam comecar em 1 e subir de 1 em 1: esperada v{expected_version}",
                migration.version, migration.description
            );
            assert!(
                matches!(migration.kind, MigrationKind::Up),
                "a migration v{} (\"{}\") nao e MigrationKind::Up; o plugin descarta as demais na conversao e ela nunca rodaria",
                migration.version,
                migration.description
            );
            if let Some(previous) =
                seen_descriptions.insert(migration.description, migration.version)
            {
                panic!(
                    "a migration v{} repete a description \"{}\", ja usada pela v{previous}",
                    migration.version, migration.description
                );
            }
        }
    }

    // `sqlite_master` guarda o SQL exatamente como veio da migration. Os
    // arquivos em `migrations/` sao LF por `.gitattributes`, e o literal
    // comparado abaixo e normalizado pelo proprio rustc; normalizar o lado do
    // banco evita uma falha de fim de linha que nao seria divergencia de
    // schema.
    async fn schema_snapshot(pool: &SqlitePool) -> String {
        let entries: Vec<(String, String, Option<String>)> =
            sqlx::query_as("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
                .fetch_all(pool)
                .await
                .expect("ler sqlite_master");

        let mut snapshot = String::new();
        for (kind, name, sql) in entries {
            snapshot.push_str(&format!("== {kind} {name}\n"));
            match sql {
                Some(sql) => {
                    snapshot.push_str(sql.replace("\r\n", "\n").trim());
                    snapshot.push('\n');
                }
                None => snapshot.push_str("<sem sql>\n"),
            }
        }
        snapshot
    }

    // Um `assert_eq!` cru entre duas strings deste tamanho imprime tudo
    // escapado numa linha so, ilegivel justamente quando mais importa ler. Este
    // helper aponta a primeira linha divergente com o contexto anterior, que e
    // o que se precisa olhar antes de decidir atualizar o snapshot.
    fn first_snapshot_difference(actual: &str, expected: &str) -> Option<String> {
        let actual_lines: Vec<&str> = actual.lines().collect();
        let expected_lines: Vec<&str> = expected.lines().collect();

        for index in 0..actual_lines.len().max(expected_lines.len()) {
            let actual_line = actual_lines.get(index).copied();
            let expected_line = expected_lines.get(index).copied();
            if actual_line == expected_line {
                continue;
            }

            let mut report = format!("primeira divergencia na linha {}:\n", index + 1);
            for line in &expected_lines[index.saturating_sub(3)..index] {
                report.push_str(&format!("   {line}\n"));
            }
            report.push_str(&format!(
                "-  {}\n+  {}\n",
                expected_line.unwrap_or("<fim do snapshot>"),
                actual_line.unwrap_or("<fim do schema lido>")
            ));
            report.push_str(&format!(
                "({} linhas no schema lido, {} no snapshot)",
                actual_lines.len(),
                expected_lines.len()
            ));
            return Some(report);
        }

        None
    }

    // Snapshot literal de `sqlite_master` depois da cadeia completa.
    //
    // As tabelas-sombra do FTS5 (`documents_fts_data`, `_idx`, `_content`,
    // `_docsize`, `_config`) entram de proposito: sao schema real, e uma
    // divergencia ali quebra a busca sem erro visivel — exatamente o defeito
    // silencioso que este teste existe para pegar. Filtrar por conveniencia
    // enfraqueceria o teste.
    //
    // Este teste falha sempre que uma migration nova muda o schema. A
    // atualizacao do snapshot e DELIBERADA: ler o diff, confirmar que a
    // mudanca e a pretendida, e so entao substituir a constante. Atualizar sem
    // ler o diff anula o teste.
    //
    // O snapshot e texto integral, nao um hash: um hash falharia dizendo
    // apenas "mudou" e obrigaria a reinvestigar do zero a cada alteracao
    // legitima de schema; o texto falha mostrando o diff.
    //
    // Aviso sobre a origem de uma falha aqui: o snapshot inclui as
    // tabelas-sombra do FTS5 (documents_fts_data, documents_fts_idx,
    // documents_fts_content, documents_fts_docsize e
    // documents_fts_config) e os indices sqlite_autoindex_*. Nenhum
    // desses e escrito pelas nossas migrations — quem os gera e o
    // proprio motor do SQLite, que chega via libsqlite3-sys.
    //
    // Consequencia pratica: um bump de sqlx ou libsqlite3-sys pode
    // quebrar este teste sem que nenhuma migration tenha mudado. Se a
    // falha aparecer sem alteracao em migrations/ nem em
    // database_migrations(), verifique o diff do Cargo.lock antes de
    // suspeitar do schema. Isso e informacao legitima, nao ruido:
    // mudou o layout real do banco em disco.
    //
    // Nao delete este teste ao encontrar uma divergencia inesperada. Leia o
    // diff primeiro.
    const MIGRATION_SCHEMA_SNAPSHOT: &str = r#"== index idx_annotations_document_id
CREATE INDEX idx_annotations_document_id ON annotations(document_id)
== index idx_annotations_document_page
CREATE INDEX idx_annotations_document_page ON annotations(document_id, page)
== index idx_canvas_files_canvas_id
CREATE INDEX idx_canvas_files_canvas_id ON canvas_files(canvas_id)
== index idx_canvases_collection_id
CREATE INDEX idx_canvases_collection_id ON canvases(collection_id)
== index idx_canvases_deleted_at
CREATE INDEX idx_canvases_deleted_at ON canvases(deleted_at)
== index idx_canvases_favorite
CREATE INDEX idx_canvases_favorite ON canvases(favorite)
== index idx_document_bookmarks_document_id
CREATE INDEX idx_document_bookmarks_document_id ON document_bookmarks(document_id)
== index idx_document_tags_tag_id
CREATE INDEX idx_document_tags_tag_id ON document_tags(tag_id)
== index idx_documents_collection_id
CREATE INDEX idx_documents_collection_id ON documents(collection_id)
== index idx_documents_deleted_at
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at)
== index idx_documents_favorite
CREATE INDEX idx_documents_favorite ON documents(favorite)
== index idx_documents_status
CREATE INDEX idx_documents_status ON documents(status)
== index idx_documents_updated_at
CREATE INDEX idx_documents_updated_at ON documents(updated_at)
== index idx_notebook_assets_notebook_page
CREATE INDEX idx_notebook_assets_notebook_page ON notebook_assets(notebook_id, page_id)
== index idx_notebook_assets_page_id
CREATE INDEX idx_notebook_assets_page_id ON notebook_assets(page_id)
== index idx_notebook_file_attachments_notebook_id
CREATE INDEX idx_notebook_file_attachments_notebook_id
  ON notebook_file_attachments(notebook_id)
== index idx_notebook_file_attachments_page_id
CREATE INDEX idx_notebook_file_attachments_page_id
  ON notebook_file_attachments(page_id)
== index idx_notebook_linked_documents_document_id
CREATE INDEX idx_notebook_linked_documents_document_id ON notebook_linked_documents(document_id)
== index idx_notebook_pages_notebook_id
CREATE INDEX idx_notebook_pages_notebook_id ON notebook_pages(notebook_id)
== index idx_notebook_tags_tag_id
CREATE INDEX idx_notebook_tags_tag_id ON notebook_tags(tag_id)
== index idx_notebooks_collection_id
CREATE INDEX idx_notebooks_collection_id ON notebooks(collection_id)
== index idx_notebooks_deleted_at
CREATE INDEX idx_notebooks_deleted_at ON notebooks(deleted_at)
== index idx_notebooks_favorite
CREATE INDEX idx_notebooks_favorite ON notebooks(favorite)
== index sqlite_autoindex__sqlx_migrations_1
<sem sql>
== index sqlite_autoindex_annotations_1
<sem sql>
== index sqlite_autoindex_app_settings_1
<sem sql>
== index sqlite_autoindex_canvas_files_1
<sem sql>
== index sqlite_autoindex_collections_1
<sem sql>
== index sqlite_autoindex_collections_2
<sem sql>
== index sqlite_autoindex_document_authors_1
<sem sql>
== index sqlite_autoindex_document_bookmarks_1
<sem sql>
== index sqlite_autoindex_document_tags_1
<sem sql>
== index sqlite_autoindex_documents_1
<sem sql>
== index sqlite_autoindex_notebook_assets_1
<sem sql>
== index sqlite_autoindex_notebook_file_attachments_1
<sem sql>
== index sqlite_autoindex_notebook_linked_documents_1
<sem sql>
== index sqlite_autoindex_notebook_tags_1
<sem sql>
== index sqlite_autoindex_tags_1
<sem sql>
== index sqlite_autoindex_tags_2
<sem sql>
== table _sqlx_migrations
CREATE TABLE _sqlx_migrations (
    version BIGINT PRIMARY KEY,
    description TEXT NOT NULL,
    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL,
    checksum BLOB NOT NULL,
    execution_time BIGINT NOT NULL
)
== table annotations
CREATE TABLE "annotations" (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page >= 1),
  color TEXT NOT NULL DEFAULT 'amber',
  selected_text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  rects_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), mark_style TEXT NOT NULL DEFAULT 'highlight'
CHECK (mark_style IN ('highlight', 'underline')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
)
== table app_settings
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
== table canvas_files
CREATE TABLE canvas_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (canvas_id, file_id),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
)
== table canvases
CREATE TABLE canvases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Canvas',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), content TEXT NOT NULL
  DEFAULT '{"elements":[],"appState":{}}', favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)), deleted_at TEXT,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
)
== table collections
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, color TEXT NOT NULL DEFAULT '#475569', description TEXT NOT NULL DEFAULT '')
== table document_authors
CREATE TABLE document_authors (
  document_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_order INTEGER NOT NULL,
  PRIMARY KEY (document_id, author_order),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
)
== table document_bookmarks
CREATE TABLE document_bookmarks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
)
== table document_tags
CREATE TABLE document_tags (
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  tag_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
)
== table documents
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  year INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in-progress', 'completed', 'not-started', 'error')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  collection_id TEXT NOT NULL,
  file_name TEXT,
  file_path TEXT,
  notes TEXT NOT NULL DEFAULT '',
  reading_location_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), deleted_at TEXT, time_spent_seconds INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', last_opened_at TEXT, annotations_filter_scope TEXT NOT NULL DEFAULT 'all'
CHECK (annotations_filter_scope IN ('all', 'current_page')), reading_list_dismissed_at TEXT,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
)
== table documents_fts
CREATE VIRTUAL TABLE documents_fts USING fts5(
  document_id UNINDEXED,
  title,
  authors,
  source,
  year,
  collection,
  tags,
  notes
)
== table documents_fts_config
CREATE TABLE 'documents_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
== table documents_fts_content
CREATE TABLE 'documents_fts_content'(id INTEGER PRIMARY KEY, c0, c1, c2, c3, c4, c5, c6, c7)
== table documents_fts_data
CREATE TABLE 'documents_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
== table documents_fts_docsize
CREATE TABLE 'documents_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
== table documents_fts_idx
CREATE TABLE 'documents_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
== table notebook_assets
CREATE TABLE notebook_assets (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  checksum TEXT,
  original_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (page_id) REFERENCES notebook_pages(id) ON DELETE CASCADE
)
== table notebook_file_attachments
CREATE TABLE notebook_file_attachments (
  id TEXT PRIMARY KEY,
  notebook_id INTEGER NOT NULL,
  page_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (page_id) REFERENCES notebook_pages(id) ON DELETE CASCADE
)
== table notebook_linked_documents
CREATE TABLE notebook_linked_documents (
  notebook_id INTEGER NOT NULL,
  document_id TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (notebook_id, document_id),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
)
== table notebook_pages
CREATE TABLE notebook_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notebook_id INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
)
== table notebook_tags
CREATE TABLE notebook_tags (
  notebook_id INTEGER NOT NULL,
  tag_id TEXT NOT NULL,
  tag_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (notebook_id, tag_id),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
)
== table notebooks
CREATE TABLE notebooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Notebook',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), description TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)), deleted_at TEXT, reading_status TEXT NOT NULL DEFAULT 'not-started'
CHECK (reading_status IN ('not-started', 'in-progress', 'completed')), author_discipline TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE CASCADE ON DELETE RESTRICT
)
== table sqlite_sequence
CREATE TABLE sqlite_sequence(name,seq)
== table tags
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color_token TEXT NOT NULL CHECK (color_token IN ('violet', 'indigo', 'blue', 'teal', 'rose', 'amber')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)
== trigger annotations_touch_updated_at
CREATE TRIGGER annotations_touch_updated_at
AFTER UPDATE ON annotations
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE annotations
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger canvases_touch_updated_at
CREATE TRIGGER canvases_touch_updated_at
AFTER UPDATE ON canvases
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE canvases
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger collections_touch_updated_at
CREATE TRIGGER collections_touch_updated_at
AFTER UPDATE ON collections
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE collections
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger documents_fts_after_author_delete
CREATE TRIGGER documents_fts_after_author_delete
AFTER DELETE ON document_authors
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = OLD.document_id;
END
== trigger documents_fts_after_author_insert
CREATE TRIGGER documents_fts_after_author_insert
AFTER INSERT ON document_authors
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END
== trigger documents_fts_after_author_update
CREATE TRIGGER documents_fts_after_author_update
AFTER UPDATE ON document_authors
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END
== trigger documents_fts_after_document_delete
CREATE TRIGGER documents_fts_after_document_delete
AFTER DELETE ON documents
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.id;
END
== trigger documents_fts_after_document_insert
CREATE TRIGGER documents_fts_after_document_insert
AFTER INSERT ON documents
FOR EACH ROW
BEGIN
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    NEW.id,
    NEW.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = NEW.id ORDER BY author_order), ''),
    NEW.source,
    CAST(NEW.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = NEW.id ORDER BY document_tags.tag_order), ''),
    NEW.notes
  FROM collections
  WHERE collections.id = NEW.collection_id;
END
== trigger documents_fts_after_document_tag_delete
CREATE TRIGGER documents_fts_after_document_tag_delete
AFTER DELETE ON document_tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = OLD.document_id;
END
== trigger documents_fts_after_document_tag_insert
CREATE TRIGGER documents_fts_after_document_tag_insert
AFTER INSERT ON document_tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END
== trigger documents_fts_after_document_tag_update
CREATE TRIGGER documents_fts_after_document_tag_update
AFTER UPDATE ON document_tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.document_id;
  DELETE FROM documents_fts WHERE document_id = NEW.document_id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id = NEW.document_id;
END
== trigger documents_fts_after_document_update
CREATE TRIGGER documents_fts_after_document_update
AFTER UPDATE ON documents
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts WHERE document_id = OLD.id;
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    NEW.id,
    NEW.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = NEW.id ORDER BY author_order), ''),
    NEW.source,
    CAST(NEW.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = NEW.id ORDER BY document_tags.tag_order), ''),
    NEW.notes
  FROM collections
  WHERE collections.id = NEW.collection_id;
END
== trigger documents_fts_after_tag_delete
CREATE TRIGGER documents_fts_after_tag_delete
AFTER DELETE ON tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts
  WHERE document_id IN (SELECT document_id FROM document_tags WHERE tag_id = OLD.id);
END
== trigger documents_fts_after_tag_update
CREATE TRIGGER documents_fts_after_tag_update
AFTER UPDATE ON tags
FOR EACH ROW
BEGIN
  DELETE FROM documents_fts
  WHERE document_id IN (SELECT document_id FROM document_tags WHERE tag_id = NEW.id);
  INSERT INTO documents_fts(document_id, title, authors, source, year, collection, tags, notes)
  SELECT
    documents.id,
    documents.title,
    COALESCE((SELECT group_concat(author, ' ') FROM document_authors WHERE document_id = documents.id ORDER BY author_order), ''),
    documents.source,
    CAST(documents.year AS TEXT),
    collections.name,
    COALESCE((SELECT group_concat(tags.name, ' ') FROM document_tags JOIN tags ON tags.id = document_tags.tag_id WHERE document_tags.document_id = documents.id ORDER BY document_tags.tag_order), ''),
    documents.notes
  FROM documents
  JOIN collections ON collections.id = documents.collection_id
  WHERE documents.id IN (SELECT document_id FROM document_tags WHERE tag_id = NEW.id);
END
== trigger documents_touch_updated_at
CREATE TRIGGER documents_touch_updated_at
AFTER UPDATE ON documents
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE documents
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger notebook_pages_touch_updated_at
CREATE TRIGGER notebook_pages_touch_updated_at
AFTER UPDATE ON notebook_pages
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE notebook_pages
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger notebooks_touch_updated_at
CREATE TRIGGER notebooks_touch_updated_at
AFTER UPDATE ON notebooks
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE notebooks
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
== trigger tags_touch_updated_at
CREATE TRIGGER tags_touch_updated_at
AFTER UPDATE ON tags
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE tags
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END
"#;

    #[tokio::test]
    async fn the_migration_chain_produces_the_snapshotted_schema() {
        let path = migration_test_db_path("schema");
        let pool = open_migration_test_pool(&path).await;
        migration_chain_migrator()
            .await
            .run(&pool)
            .await
            .expect("aplicar a cadeia completa de migrations");

        let snapshot = schema_snapshot(&pool).await;

        close_migration_test_pool(pool, &path).await;

        if let Some(difference) = first_snapshot_difference(&snapshot, MIGRATION_SCHEMA_SNAPSHOT) {
            panic!(
                "o schema produzido pela cadeia divergiu do snapshot.\n{difference}\n\nLeia a divergencia acima e so atualize MIGRATION_SCHEMA_SNAPSHOT depois de confirmar que a mudanca e a pretendida."
            );
        }
    }
}
