use crate::{validate_file_id, validate_numeric_path_id, DATABASE_KEY};
use base64::Engine;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

// ===========================================================================
// save_notebook_asset / load_notebook_assets — binarios das paginas de Caderno.
//
// Primeira fase: infraestrutura de persistencia, sem alterar ainda o paste do
// editor. O HTML de notebook_pages.content deve guardar so referencias
// (`data-notebook-asset-id` no futuro); bytes ficam em disco.
// ===========================================================================

const MAX_NOTEBOOK_ASSET_BYTES: usize = 4 * 1024 * 1024;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotebookAssetMetadata {
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
pub(crate) struct NotebookAssetData {
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
pub(crate) async fn save_notebook_asset<R: tauri::Runtime>(
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
pub(crate) async fn load_notebook_assets<R: tauri::Runtime>(
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
