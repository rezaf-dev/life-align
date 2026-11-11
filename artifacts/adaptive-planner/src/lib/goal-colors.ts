import type { Goal } from './store/types';

const PALETTE = [
  '#397CB8', '#3F9276', '#B77A35', '#A65E88', '#5595A3', '#A86B50',
  '#7B8E3F', '#6875AC', '#B25E69', '#568864', '#9C784E', '#638DAF',
  '#9675A0', '#439A94', '#AA8554', '#827B58',
];
const valid = (color: string | undefined): color is string => !!color && /^#[0-9a-f]{6}$/i.test(color);

/** Saved colors never depend on category, title, list order, or a goal's status. */
export function assignGoalColors(goals: Pick<Goal, 'id' | 'createdAt' | 'color'>[]) {
  const ordered = [...goals].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const missing: typeof goals[number][] = [];
  for (const goal of ordered) {
    if (valid(goal.color) && !used.has(goal.color.toLowerCase())) used.add(goal.color.toLowerCase());
    else missing.push(goal);
  }
  let next = 0;
  for (const goal of missing) {
    let color = PALETTE.find((c) => !used.has(c.toLowerCase()));
    while (!color) {
      // Expand beyond the curated palette without recycling an existing color.
      const band = Math.floor(next / 360);
      const hue = (next++ * 137.508) % 360;
      const c = 0.32 + (band % 4) * 0.06, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = 0.18 + (Math.floor(band / 4) % 8) * 0.035;
      const rgb = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
      const candidate = `#${rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
      if (!used.has(candidate)) color = candidate;
    }
    goal.color = color;
    used.add(color.toLowerCase());
  }
}
