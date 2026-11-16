import type { StoryModel, StoryPosition } from './story';
export interface WorldOpts {
  mobile: boolean;
  reduced: boolean;
  /** Models in story order, lightest first, with their own offered levels. */
  models: StoryModel[];
}
export interface World {
  mount(el: HTMLElement, opts: WorldOpts): void | Promise<void>;
  frame(pos: StoryPosition, t: number): void;
  /** Names of one-shot sounds fired since the last call (for example 'croak'); the list is cleared on read. */
  cues?(): string[];
  destroy(): void;
}
export type WorldName = 'claude' | 'openai' | 'gemini';

const loaders: Record<WorldName, () => Promise<{ create(): World }>> = {
  claude: () => import('./worlds/claude'),
  openai: () => import('./worlds/openai'),
  gemini: () => import('./worlds/gemini'),
};

export async function loadWorld(name: WorldName, el: HTMLElement, opts: WorldOpts, fallback: boolean): Promise<World | null> {
  let world: World | null = null;
  try {
    world = (await loaders[name]()).create();
    await world.mount(el, opts);
    return world;
  } catch (error) {
    console.warn(`[guide] ${name} world unavailable`, error);
    try { world?.destroy(); } catch { /* half-mounted */ }
    if (!fallback) return null;
    el.innerHTML = '';
    const { ENGINES } = await import('./legacy-engines');
    const legacy = new (ENGINES[name] as unknown as new () => {
      mount(el: HTMLElement, opts: WorldOpts): void;
      frame(model: number, t: number): void;
      destroy(): void;
    })();
    legacy.mount(el, opts);
    return { mount() {}, frame(pos, t) { legacy.frame(pos.model, t); }, destroy() { legacy.destroy(); } };
  }
}
