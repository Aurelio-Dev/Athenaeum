import { useCallback, useEffect, useRef } from "react";

// Debounce de autosave da posicao de leitura: agrupa chamadas rapidas (scroll,
// zoom, troca de pagina) e so dispara `save` apos `delay` ms sem novas chamadas.
// Mesmo padrao que usariamos para as notas livres.
//
// Motivo (confiabilidade, prioridade #1): salvar so no fechamento perderia a
// sessao inteira num crash no meio da leitura. Com o debounce, perde-se no
// maximo ~750ms; o flush exato no fechamento continua sendo feito pelo
// closeAndSave (onClose).
export function useReaderPersistence(save: () => void, delay = 750) {
  // Mantemos a ultima versao de `save` num ref para o timer sempre chamar o
  // closure mais recente (com a posicao/zoom atuais), sem reagendar a cada render.
  const saveRef = useRef(save);
  saveRef.current = save;
  const timerRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    cancel();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      saveRef.current();
    }, delay);
  }, [cancel, delay]);

  // Ao desmontar, cancela o timer pendente. Nao fazemos flush aqui (os refs do
  // DOM ja podem estar mortos); o flush exato e responsabilidade do closeAndSave.
  useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
}
