use crate::{
    resolve_app_data_relative_path, sanitize_attachment_file_name, validate_file_id, DATABASE_KEY,
};
use base64::write::EncoderWriter;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

// Destinos de exportacao AUTORIZADOS pelo usuario via dialogo nativo nesta
// sessao. write_notebook_export so grava em um caminho presente aqui: o
// WebView nao consegue inventar um destino — todo caminho de escrita passou
// por uma escolha explicita do usuario no dialogo de salvar.
#[derive(Default)]
pub(crate) struct NotebookExportDestinations(std::sync::Mutex<HashSet<PathBuf>>);

// Teto do conjunto de autorizacoes: no fluxo normal ha no maximo um destino
// pendente por vez (dialogo -> preparar -> gravar, que consome). Destinos
// abandonados (dialogo aberto e nunca gravado, ou "Trocar destino") nao devem
// se acumular numa sessao longa. Ao estourar, limpamos os obsoletos antes de
// registrar o novo — a escolha atual sempre sobrevive.
const MAX_AUTHORIZED_EXPORT_DESTINATIONS: usize = 32;

#[tauri::command]
pub(crate) fn select_notebook_export_destination(
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
pub(crate) struct NotebookExportManifestInput {
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
pub(crate) struct NotebookExportWriteResult {
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
pub(crate) async fn write_notebook_export<R: tauri::Runtime>(
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

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

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
}
