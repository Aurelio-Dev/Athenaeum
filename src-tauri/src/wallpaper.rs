use serde::Serialize;
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

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
pub(crate) struct WallpaperImportSources(std::sync::Mutex<HashSet<PathBuf>>);

// No fluxo normal ha no maximo uma escolha pendente (dialogo -> importar, que
// consome). Escolhas abandonadas (dialogo aberto e import cancelado) nao devem
// se acumular numa sessao longa.
const MAX_AUTHORIZED_WALLPAPER_SOURCES: usize = 8;

#[derive(Serialize)]
pub(crate) struct SelectedWallpaperImage {
    file_name: String,
    file_path: String,
}

#[derive(Serialize)]
pub(crate) struct ImportedWallpaper {
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
pub(crate) fn select_wallpaper_image(
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
pub(crate) async fn import_wallpaper<R: tauri::Runtime>(
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
pub(crate) fn resolve_wallpaper_path<R: tauri::Runtime>(
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
pub(crate) fn remove_wallpaper<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel achar o diretorio de dados: {error}"))?;

    sweep_wallpaper_directory(&wallpaper_directory(&data_dir), None);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
