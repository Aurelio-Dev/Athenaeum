// Apaga o perfil de dados do perfil de DESENVOLVIMENTO do Athenaeum.
//
// O identifier vem do overlay src-tauri/tauri.dev.conf.json, que e a unica
// fonte de verdade: sem copia do valor aqui, o script nao consegue apontar
// para um diretorio diferente do que o `npm run tauri:dev` usa.
//
// Uso: npm run dev:reset

import { readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const devConfigPath = resolve(scriptDir, "..", "src-tauri", "tauri.dev.conf.json");

if (!existsSync(devConfigPath)) {
  console.error(`Overlay de dev nao encontrado: ${devConfigPath}`);
  process.exit(1);
}

const devConfig = JSON.parse(readFileSync(devConfigPath, "utf8"));
const identifier = devConfig.identifier;

if (typeof identifier !== "string" || identifier.length === 0) {
  console.error("O overlay de dev nao define um identifier.");
  process.exit(1);
}

// GUARDA: o unico diretorio que este script pode apagar e o do perfil de dev.
// Se o overlay for editado para o identifier de producao (por engano ou por
// merge ruim), o script morre aqui em vez de apagar a biblioteca real.
if (!identifier.endsWith(".dev")) {
  console.error(
    `RECUSADO: o identifier "${identifier}" nao termina em ".dev".\n` +
      "Este script so apaga o perfil de desenvolvimento. Se a intencao era\n" +
      "mesmo apagar outro perfil, faca isso manualmente e por sua conta.",
  );
  process.exit(1);
}

// O perfil de dev ocupa DOIS diretorios, e apagar so o primeiro nao da um
// estado limpo de verdade:
//
// - Roaming\<id>       -> athenaeum.db (+ -wal/-shm) e os PDFs importados;
// - Local\<id>\EBWebView -> perfil do WebView2, onde vive o localStorage
//                           (tema, material, ultima cor de realce).
//
// Verificado nesta maquina: o WebView2 TAMBEM separa por identifier, entao o
// diretorio Local do perfil de dev e distinto do de producao.
function profileDirsFor(id) {
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA;
    const local = process.env.LOCALAPPDATA;
    if (!roaming || !local) {
      throw new Error("APPDATA ou LOCALAPPDATA nao estao definidos no ambiente.");
    }
    return [
      { rotulo: "dados do app (SQLite, PDFs)", caminho: join(roaming, id) },
      { rotulo: "perfil do WebView2 (localStorage)", caminho: join(local, id) },
    ];
  }

  if (process.platform === "darwin") {
    return [
      { rotulo: "dados do app", caminho: join(homedir(), "Library", "Application Support", id) },
    ];
  }

  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return [{ rotulo: "dados do app", caminho: join(dataHome, id) }];
}

let apagados = 0;

for (const { rotulo, caminho } of profileDirsFor(identifier)) {
  // Segunda guarda, agora sobre o caminho ja resolvido: protege contra uma
  // variavel de ambiente vazia que faca o join apontar para a raiz de
  // %APPDATA%/%LOCALAPPDATA% em vez do perfil.
  if (!caminho.endsWith(".dev")) {
    console.error(`RECUSADO: o caminho resolvido nao termina em ".dev": ${caminho}`);
    process.exit(1);
  }

  if (!existsSync(caminho)) {
    console.log(`- ${rotulo}: nada a apagar (${caminho})`);
    continue;
  }

  if (!statSync(caminho).isDirectory()) {
    console.error(`RECUSADO: o caminho existe mas nao e um diretorio: ${caminho}`);
    process.exit(1);
  }

  rmSync(caminho, { recursive: true, force: true });
  console.log(`- ${rotulo}: apagado (${caminho})`);
  apagados += 1;
}

if (apagados === 0) {
  console.log("\nO perfil de dev ainda nao existia.");
} else {
  console.log("\nO proximo `npm run tauri:dev` recria o banco do zero, rodando v1..v23.");
}
