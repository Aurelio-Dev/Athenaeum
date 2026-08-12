-- Acrescenta o modo de desenho da marcacao sem reescrever a tabela nem os
-- registros existentes. Em SQLite, o DEFAULT tambem preenche logicamente as
-- linhas antigas; por isso todo destaque ja salvo continua sendo marca-texto.
ALTER TABLE annotations
ADD COLUMN mark_style TEXT NOT NULL DEFAULT 'highlight'
CHECK (mark_style IN ('highlight', 'underline'));

-- O CHECK protege o dominio no proprio banco. Mesmo que uma chamada futura
-- deixe de validar a entrada em TypeScript, somente os dois estilos conhecidos
-- poderao ser persistidos.
