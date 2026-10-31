import type { QueueItem } from '@sleep-stories/contracts';
import { deriveHintText, deriveMenu, deriveRow } from './rows';

const ID = '00000000-0000-4000-8000-000000000001';
const base = { id: ID, topicId: ID, title: 'Лис и звёздная карта', style: 'fairy_tale' as const };
const ready: QueueItem = {
  ...base,
  style: 'facts',
  state: 'ready',
  storyId: ID,
  durationSec: 151,
  audioUrl: 'https://example.invalid/a.mp3',
};
const notReady: QueueItem = { ...base, state: 'not_ready' };
const creating: QueueItem = { ...base, state: 'creating' };
const failed: QueueItem = { ...base, state: 'failed' };
const gens = (left: number, limit = 5) => ({ left, limit });

describe('deriveRow', () => {
  it('shows style and duration for a ready item', () => {
    expect(deriveRow(ready)).toEqual({
      id: ID,
      title: 'Лис и звёздная карта',
      styleLabel: 'Факты',
      state: 'ready',
      durationText: '2:31',
      statusLabel: null,
      statusDetail: null,
      action: null,
      statusText: '2:31',
    });
  });

  it('offers the hint sheet on a not-ready item', () => {
    const row = deriveRow(notReady);
    expect(row.styleLabel).toBe('Сказка');
    expect(row.action).toEqual({ kind: 'hint', label: 'Не готова' });
    expect(row.durationText).toBeNull();
    expect(row.statusText).toBe('Не готова');
  });

  it('shows the creating status with an estimate and no action', () => {
    const row = deriveRow(creating);
    expect(row.statusLabel).toBe('Создаётся');
    expect(row.statusDetail).toBe('~2 мин');
    expect(row.action).toBeNull();
    expect(row.statusText).toBe('Создаётся · ~2 мин');
  });

  it('offers a retry on a failed item', () => {
    const row = deriveRow(failed);
    expect(row.statusLabel).toBe('Не удалось');
    expect(row.action).toEqual({ kind: 'retry', label: 'Повторить' });
  });
});

describe('deriveMenu', () => {
  it('hides «Создать сейчас» for ready and creating items', () => {
    expect(deriveMenu(ready, 0, gens(5)).createNow).toBeNull();
    expect(deriveMenu(creating, 0, gens(5)).createNow).toBeNull();
  });

  it('offers «Создать сейчас» with its cost for not_ready and failed items', () => {
    for (const item of [notReady, failed]) {
      expect(deriveMenu(item, 0, gens(3)).createNow).toEqual({
        label: 'Создать сейчас',
        detail: '1 из 3',
        enabled: true,
      });
    }
  });

  it('turns «Создать сейчас» inactive at zero generations left', () => {
    expect(deriveMenu(notReady, 0, gens(0)).createNow).toEqual({
      label: 'Создать сейчас',
      detail: 'Генераций не осталось',
      enabled: false,
    });
  });

  it('keeps «Другая история», «Выбрать из тем» and «Убрать» live', () => {
    const menu = deriveMenu(notReady, 1, gens(0));
    expect(menu.another).toMatchObject({ label: 'Другая история', enabled: true });
    expect(menu.remove).toMatchObject({ label: 'Убрать', enabled: true });
    expect(menu.chooseFromTopics).toMatchObject({ label: 'Выбрать из тем', enabled: true });
  });

  it('writes the header as in the design', () => {
    const menu = deriveMenu(notReady, 1, gens(2));
    expect(menu.position).toBe('История 02');
    expect(menu.title).toBe('Лис и звёздная карта');
    expect(menu.meta).toBe('Сказка · Не готова');
    expect(deriveMenu(ready, 0, gens(2)).meta).toBe('Факты · 2:31');
  });
});

describe('deriveHintText', () => {
  it('names the allowance from the server', () => {
    expect(deriveHintText(gens(2, 5))).toBe(
      'Её нужно создать — это займёт 1–2 минуты и потратит 1 генерацию. Сейчас осталось 2 из 5.',
    );
    expect(deriveHintText(gens(0, 4))).toContain('осталось 0 из 4');
  });
});
