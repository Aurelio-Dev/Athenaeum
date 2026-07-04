-- ============================================================
-- v14 - Configuracoes do app (chave-valor)
-- ============================================================

-- Preferencias globais do app que precisam sobreviver entre sessoes. Modelo
-- chave-valor DE PROPOSITO, nao descuido: nesta primeira versao ha uma unica
-- configuracao persistida aqui (icon_variant, a variante do icone do app), e a
-- lista deve crescer devagar (poucas preferencias globais). Uma tabela
-- normalizada com uma coluna por preferencia seria abstracao prematura para
-- esse volume; se a lista crescer muito no futuro, reavaliamos o modelo.
--
-- O TEMA nao vive aqui: continua em localStorage no frontend. Leitura sincrona
-- do localStorage antes do primeiro paint evita o flash de tema errado na
-- abertura, coisa que uma leitura assincrona do SQLite (via IPC) traria.
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
