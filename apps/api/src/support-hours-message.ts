export type SupportHoursRow = {
  day_of_week: number | null;
  is_open: boolean | null;
  start_time: string | null;
  end_time: string | null;
};

const weekdays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function hourLabel(value: string): string | null {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const twelve = ((hour + 11) % 12) + 1;
  return `${twelve}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'a. m.' : 'p. m.'}`;
}

/** A public schedule derived only from configured company_support_hours. */
export function formatConfiguredSupportHours(rows: SupportHoursRow[]): string {
  const active = rows
    .filter((r) => r.is_open && Number.isInteger(r.day_of_week) && r.day_of_week! >= 0 && r.day_of_week! <= 6)
    .map((r) => ({
      day: r.day_of_week as number,
      from: r.start_time ? hourLabel(r.start_time) : null,
      to: r.end_time ? hourLabel(r.end_time) : null,
    }))
    .filter((r): r is {day:number;from:string;to:string} => Boolean(r.from && r.to))
    .sort((a,b) => a.day - b.day);

  if (!active.length) return '';
  if (
    active.length === 6 &&
    active.every((r,i) => r.day === i + 1 && r.from === active[0].from && r.to === active[0].to)
  ) {
    return `lunes a sábado, de ${active[0].from} a ${active[0].to}`;
  }
  if (
    active.length === 7 &&
    active.every((r,i) => r.day === i && r.from === active[0].from && r.to === active[0].to)
  ) {
    return `todos los días, de ${active[0].from} a ${active[0].to}`;
  }
  return active.map((r) => `${weekdays[r.day]} de ${r.from} a ${r.to}`).join('; ');
}
