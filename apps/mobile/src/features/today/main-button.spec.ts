import type { QueueItem, QueueResponse } from '@sleep-stories/contracts';
import { countNeedingGeneration, deriveMainButton, hasCreating } from './main-button';

let seq = 0;
function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

function item(state: QueueItem['state'], durationSec = 150): QueueItem {
  const base = { id: uuid(), topicId: uuid(), title: 'Почему мы икаем', style: 'facts' as const };
  if (state === 'ready') {
    return {
      ...base,
      state,
      storyId: uuid(),
      durationSec,
      audioUrl: 'https://example.invalid/a.mp3',
    };
  }
  return { ...base, state };
}

const gens = (left: number, limit = 5): QueueResponse['generations'] => ({ left, limit });

describe('deriveMainButton', () => {
  it('returns null for an empty queue', () => {
    expect(deriveMainButton([], gens(5))).toBeNull();
  });

  it('shows the progress state while anything is being created', () => {
    const view = deriveMainButton([item('ready'), item('creating'), item('not_ready')], gens(0));
    expect(view).toMatchObject({
      kind: 'creating',
      label: 'Создаётся…',
      disabled: true,
      action: 'none',
      showsProgress: true,
    });
    expect(view?.caption).toEqual({ text: 'Начнём сами, когда всё будет готово', link: null });
  });

  it('creating wins over a shortage', () => {
    expect(deriveMainButton([item('creating'), item('failed')], gens(0))?.kind).toBe('creating');
  });

  it('offers «Начать» that does nothing when everything is ready', () => {
    const view = deriveMainButton([item('ready', 151), item('ready', 184), item('ready', 203)], gens(2));
    expect(view).toMatchObject({
      kind: 'start',
      label: 'Начать',
      disabled: false,
      action: 'none',
      showsProgress: false,
    });
    // (151 + 184 + 203) / 60 = 8.97 -> 9
    expect(view?.caption.text).toBe('3 истории · 9 мин');
  });

  it('declines the stories noun in the all-ready caption', () => {
    expect(deriveMainButton([item('ready', 600)], gens(5))?.caption.text).toBe('1 история · 10 мин');
    expect(
      deriveMainButton(Array.from({ length: 5 }, () => item('ready', 60)), gens(5))?.caption.text,
    ).toBe('5 историй · 5 мин');
  });

  it('starts generating all when the allowance covers it', () => {
    const view = deriveMainButton([item('ready'), item('not_ready'), item('failed')], gens(3));
    expect(view).toMatchObject({
      kind: 'create-and-start',
      label: 'Создать и начать',
      disabled: false,
      action: 'generate-all',
    });
    expect(view?.caption.text).toBe('Займёт ~2 мин · 2 генерации из 3 оставшихся');
  });

  it('allows exactly enough generations and agrees with a single remaining one', () => {
    const view = deriveMainButton([item('not_ready')], gens(1));
    expect(view?.action).toBe('generate-all');
    expect(view?.caption.text).toBe('Займёт ~2 мин · 1 генерация из 1 оставшейся');
  });

  it('is inactive with a shortage caption and an inert link when left < need', () => {
    const view = deriveMainButton([item('ready'), item('not_ready'), item('not_ready')], gens(1));
    expect(view).toMatchObject({
      kind: 'create-blocked',
      label: 'Создать и начать',
      disabled: true,
      action: 'none',
    });
    expect(view?.caption).toEqual({
      text: 'Нужно 2 генерации, осталось 1. Можно выбрать',
      link: { label: 'готовые истории', tail: '.' },
    });
  });

  it('has its own caption when no generations are left', () => {
    const view = deriveMainButton([item('failed')], gens(0));
    expect(view?.disabled).toBe(true);
    expect(view?.action).toBe('none');
    expect(view?.caption.text).toBe('Генераций не осталось. Можно выбрать');
    expect(view?.caption.link?.label).toBe('готовые истории');
  });

  it('never returns generate-all unless it is active', () => {
    for (let left = 0; left <= 5; left += 1) {
      const view = deriveMainButton([item('not_ready'), item('failed')], gens(left));
      expect(view?.action === 'generate-all').toBe(left >= 2);
      if (view?.action === 'generate-all') expect(view.disabled).toBe(false);
    }
  });
});

describe('queue predicates', () => {
  it('counts not_ready and failed as needing a generation', () => {
    const items = [item('ready'), item('not_ready'), item('failed'), item('creating')];
    expect(countNeedingGeneration(items)).toBe(2);
    expect(hasCreating(items)).toBe(true);
    expect(hasCreating([item('ready')])).toBe(false);
  });
});
