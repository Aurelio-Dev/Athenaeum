const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

// Formata a linha "Editado ..." dos cards de cadernos/quadros em pt-BR.
// Recebe o updated_at ISO (UTC, com Z) persistido pelo SQLite.
export function formatEditedAgo(isoDate: string): string {
  const elapsedMs = Date.now() - new Date(isoDate).getTime();

  if (!Number.isFinite(elapsedMs) || elapsedMs < MINUTE_MS) {
    return "Editado agora";
  }

  if (elapsedMs < HOUR_MS) {
    const minutes = Math.floor(elapsedMs / MINUTE_MS);
    return `Editado há ${minutes} min`;
  }

  if (elapsedMs < DAY_MS) {
    const hours = Math.floor(elapsedMs / HOUR_MS);
    return `Editado há ${hours} ${hours === 1 ? "hora" : "horas"}`;
  }

  const days = Math.floor(elapsedMs / DAY_MS);
  if (days === 1) {
    return "Editado ontem";
  }

  if (elapsedMs < WEEK_MS) {
    return `Editado há ${days} dias`;
  }

  if (elapsedMs < MONTH_MS) {
    const weeks = Math.floor(elapsedMs / WEEK_MS);
    return `Editado há ${weeks} ${weeks === 1 ? "semana" : "semanas"}`;
  }

  const months = Math.floor(elapsedMs / MONTH_MS);
  return `Editado há ${months} ${months === 1 ? "mês" : "meses"}`;
}
