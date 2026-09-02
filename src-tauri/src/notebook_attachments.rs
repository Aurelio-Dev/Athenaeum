use crate::{
    open_file_with_system, open_path_in_file_manager, resolve_app_data_relative_path,
    sanitize_attachment_file_name, validate_file_id, validate_numeric_path_id, DATABASE_KEY,
};
use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

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
pub(crate) struct NotebookFileAttachmentMetadata {
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
pub(crate) async fn save_notebook_file_attachment<R: tauri::Runtime>(
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
pub(crate) async fn open_notebook_file_attachment<R: tauri::Runtime>(
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
pub(crate) async fn reveal_notebook_file_attachment<R: tauri::Runtime>(
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
pub(crate) async fn delete_notebook_file_attachment<R: tauri::Runtime>(
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
pub(crate) async fn load_notebook_file_attachments(
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
