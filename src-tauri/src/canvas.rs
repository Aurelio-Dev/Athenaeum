use crate::{validate_file_id, DATABASE_KEY};
use base64::Engine;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

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

#[tauri::command]
pub(crate) async fn save_canvas_file<R: tauri::Runtime>(
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
pub(crate) struct CanvasFileData {
    file_id: String,
    mime_type: String,
    data_base64: String,
}

#[tauri::command]
pub(crate) async fn load_canvas_files<R: tauri::Runtime>(
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
