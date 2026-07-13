import { useEffect, useRef, useState } from "react";

// Observa se o elemento esta (proximo de) visivel na viewport. Usado para
// virtualizar conteudo caro de renderizar (paginas do PDF no leitor e
// miniaturas na sidebar): o rootMargin positivo pre-carrega um pouco antes
// do elemento entrar na tela.
export function useInViewport<T extends Element>(rootMargin: string) {
  const elementRef = useRef<T | null>(null);
  const [isInViewport, setIsInViewport] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInViewport(entry.isIntersecting);
      },
      { root: null, rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { elementRef, isInViewport };
}
