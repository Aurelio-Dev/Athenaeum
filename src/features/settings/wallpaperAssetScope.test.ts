import { describe, expect, it } from "vitest";
// Importa o arquivo de configuracao REAL, o mesmo que o build do Tauri le.
// Uma copia do escopo aqui dentro tornaria o teste decorativo: ele passaria
// enquanto a configuracao de verdade abria a maquina inteira.
import tauriConfig from "../../../src-tauri/tauri.conf.json";

// Guarda do ESCOPO do protocolo asset.
//
// O protocolo asset serve arquivos do disco direto para o WebView. O app
// renderiza PDF de terceiros via pdf.js e HTML persistido no Caderno, entao um
// escopo amplo ($HOME, $DOCUMENT, um caminho arbitrario) transformaria um XSS
// em exfiltracao de arquivos: o script leria qualquer arquivo alcancavel e o
// mandaria embora. O escopo existe por uma unica razao — a previa e o desenho
// do papel de parede — e a lista precisa continuar com um item so.
//
// Este teste falha alto se alguem acrescentar um caminho. Acrescentar de
// proposito e uma decisao de seguranca, e passa por editar esta lista.
const assetProtocol = tauriConfig.app.security.assetProtocol;

describe("escopo do protocolo asset", () => {
  it("esta declarado e habilitado", () => {
    expect(assetProtocol.enable).toBe(true);
  });

  it("libera EXATAMENTE a subpasta wallpaper do diretorio de dados do app", () => {
    expect(assetProtocol.scope.allow).toEqual(["$APPDATA/wallpaper/*"]);
  });

  it("nao usa curinga recursivo: so os arquivos diretamente na pasta", () => {
    // `*` nao atravessa separador de diretorio no matcher do Tauri
    // (require_literal_separator), entao uma subpasta plantada dentro de
    // wallpaper/ nao seria servida. `**` mudaria isso.
    for (const pattern of assetProtocol.scope.allow) {
      expect(pattern).not.toContain("**");
    }
  });

  it("nao alcanca a casa do usuario, documentos, downloads nem a raiz dos dados", () => {
    const proibidos = ["$HOME", "$DOCUMENT", "$DOWNLOAD", "$DESKTOP", "$PICTURE", "$RESOURCE"];

    for (const pattern of assetProtocol.scope.allow) {
      for (const proibido of proibidos) {
        expect(pattern.startsWith(proibido)).toBe(false);
      }
      // $APPDATA sozinho serviria o banco SQLite e os PDFs importados.
      expect(pattern.startsWith("$APPDATA/wallpaper/")).toBe(true);
    }
  });
});
