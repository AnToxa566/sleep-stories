import { showToast, useToastStore } from './toast-store';

describe('toast store', () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });

  it('shows a toast with a label, a title and a kind', () => {
    showToast({ label: 'Убрали', title: 'Лис', kind: 'remove' });
    expect(useToastStore.getState().current).toMatchObject({
      label: 'Убрали',
      title: 'Лис',
      kind: 'remove',
    });
  });

  it('defaults to no title and the plain kind', () => {
    showToast({ label: 'Очередь изменилась' });
    expect(useToastStore.getState().current).toMatchObject({ title: null, kind: 'plain' });
  });

  it('replaces the current toast and gives the new one a new id', () => {
    showToast({ label: 'Убрали', title: 'A' });
    const first = useToastStore.getState().current;
    showToast({ label: 'Убрали', title: 'A' });
    const second = useToastStore.getState().current;
    expect(second?.id).not.toBe(first?.id);
  });

  it('hides only the toast with the given id', () => {
    showToast({ label: 'one' });
    const stale = useToastStore.getState().current?.id ?? 0;
    showToast({ label: 'two' });
    useToastStore.getState().hide(stale);
    expect(useToastStore.getState().current?.label).toBe('two');
    useToastStore.getState().hide(useToastStore.getState().current?.id ?? 0);
    expect(useToastStore.getState().current).toBeNull();
  });
});
