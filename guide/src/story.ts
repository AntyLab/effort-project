/** Shared stop contract: model travel and effort changes occupy separate intervals. */
export interface StoryModel { id: string; efforts: string[] }
export interface StoryStop { model: number; level: number; active: boolean }
export type StoryPosition = StoryStop;
export function buildStops(models: StoryModel[]): StoryStop[] {
  return models.flatMap((m, model) => [
    { model, level: 0, active: false },
    ...m.efforts.map((_, level) => ({ model, level, active: true })),
  ]);
}
/** Scroll distance after each plate, in viewport heights. The last plate needs no outgoing interval. */
function intervalWeight(stop: StoryStop): number { return stop.active ? 0.4 : 0.7; }
export function storyScrollWeight(stops: StoryStop[]): number {
  return stops.slice(0, -1).reduce((total, stop) => total + intervalWeight(stop), 0);
}
/** Normalized snap/jump positions shared by scroll input and button navigation. */
export function stopProgress(stops: StoryStop[]): number[] {
  const total = storyScrollWeight(stops);
  let distance = 0;
  return stops.map((stop, index) => {
    const position = total ? distance / total : 0;
    if (index < stops.length - 1) distance += intervalWeight(stop);
    return position;
  });
}
export function stopToProgress(stops: StoryStop[], value: number): number {
  if (stops.length < 2) return 0;
  const positions = stopProgress(stops);
  const coordinate = Math.max(0, Math.min(stops.length - 1, value));
  const lower = Math.floor(coordinate), upper = Math.ceil(coordinate);
  return positions[lower] + (positions[upper] - positions[lower]) * (coordinate - lower);
}
export function progressToStop(stops: StoryStop[], progress: number): number {
  if (stops.length < 2) return 0;
  const positions = stopProgress(stops);
  const position = Math.max(0, Math.min(1, progress));
  const upper = positions.findIndex(point => point >= position);
  if (upper <= 0) return upper === -1 ? stops.length - 1 : 0;
  const lower = upper - 1;
  return lower + (position - positions[lower]) / (positions[upper] - positions[lower]);
}
export function storyPosition(stops: StoryStop[], value: number, reduced = false): StoryPosition {
  const u = Math.max(0, Math.min(stops.length - 1, value));
  const a = stops[Math.floor(u)], b = stops[Math.ceil(u)];
  if (reduced) return { ...stops[Math.round(u)] };
  const p = u - Math.floor(u);
  if (a.model !== b.model) {
    return { model: a.model + (b.model - a.model) * p * p * (3 - 2 * p), level: 0, active: false };
  }
  return { model: a.model, level: a.level + (b.level - a.level) * p, active: stops[Math.round(u)].active };
}
