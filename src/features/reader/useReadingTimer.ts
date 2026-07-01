import { useCallback, useEffect, useRef, useState } from "react";
import { incrementDocumentReadingTime } from "../../lib/database";

const minuteInMs = 60_000;

export function formatReadingTime(seconds: number) {
  if (seconds < 60) {
    return "< 1 min";
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}min`;
}

export function useReadingTimer(documentId: string, initialSeconds: number) {
  const [timeSpentSeconds, setTimeSpentSeconds] = useState(initialSeconds);
  const sessionStartRef = useRef<number | null>(Date.now());
  const elapsedRef = useRef(0);
  const isSavingRef = useRef(false);

  const flush = useCallback(async () => {
    const now = Date.now();

    if (sessionStartRef.current !== null) {
      elapsedRef.current += now - sessionStartRef.current;
      sessionStartRef.current = now;
    }

    const seconds = Math.floor(elapsedRef.current / 1000);

    if (seconds <= 0 || isSavingRef.current) {
      return;
    }

    elapsedRef.current -= seconds * 1000;
    isSavingRef.current = true;

    try {
      await incrementDocumentReadingTime(documentId, seconds);
      setTimeSpentSeconds((current) => current + seconds);
    } catch (error) {
      elapsedRef.current += seconds * 1000;
      console.warn("Nao foi possivel salvar o tempo de leitura.", error);
    } finally {
      isSavingRef.current = false;
    }
  }, [documentId]);

  useEffect(() => {
    setTimeSpentSeconds(initialSeconds);
    elapsedRef.current = 0;
    sessionStartRef.current = document.hasFocus() ? Date.now() : null;
  }, [documentId, initialSeconds]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void flush();
    }, minuteInMs);

    function handleBlur() {
      const now = Date.now();
      if (sessionStartRef.current !== null) {
        elapsedRef.current += now - sessionStartRef.current;
        sessionStartRef.current = null;
      }
    }

    function handleFocus() {
      if (sessionStartRef.current === null) {
        sessionStartRef.current = Date.now();
      }
    }

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      void flush();
    };
  }, [flush]);

  return { timeSpentSeconds, flushReadingTime: flush };
}
