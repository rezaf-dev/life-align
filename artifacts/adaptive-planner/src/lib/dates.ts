import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

export const iso = (d: Date) => format(d, 'yyyy-MM-dd');
export const todayIso = () => iso(new Date());
export const nowStamp = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");
export const fromIso = (s: string) => parseISO(s);
export const addDaysIso = (s: string, n: number) => iso(addDays(parseISO(s), n));
export const addMonthsIso = (s: string, n: number) => iso(addMonths(parseISO(s), n));
export const weekStartIso = (s: string) => iso(startOfWeek(parseISO(s), { weekStartsOn: 1 }));
export const monthStartIso = (s: string) => iso(startOfMonth(parseISO(s)));
export const monthEndIso = (s: string) => iso(endOfMonth(parseISO(s)));
export const daysBetween = (a: string, b: string) =>
  differenceInCalendarDays(parseISO(b.slice(0, 10)), parseISO(a.slice(0, 10)));
export const fmt = (s: string, f = 'MMM d') => format(parseISO(s), f);

export function relDay(s: string, base = todayIso()) {
  const d = daysBetween(base, s);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d < 7) return fmt(s, 'EEEE');
  return fmt(s, d < -300 || d > 300 ? 'MMM d, yyyy' : 'MMM d');
}

export function nextMonday(base = todayIso()) {
  return addDaysIso(weekStartIso(base), 7);
}

export const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
