import { JobHandlerRegistry, type JobHandler } from './job-handler';

const handler = (kind: JobHandler['kind']): JobHandler => ({ kind, run: async () => undefined });

describe('JobHandlerRegistry', () => {
  it('is valid with no handlers', () => {
    expect(new JobHandlerRegistry().get('write_story')).toBeUndefined();
    expect(new JobHandlerRegistry([]).get('render_audio')).toBeUndefined();
  });

  it('finds a handler by kind', () => {
    const write = handler('write_story');
    const render = handler('render_audio');
    const registry = new JobHandlerRegistry([write, render]);
    expect(registry.get('write_story')).toBe(write);
    expect(registry.get('render_audio')).toBe(render);
    expect(registry.get('suggest_topics')).toBeUndefined();
  });

  it('throws at construction when two handlers share a kind', () => {
    expect(
      () => new JobHandlerRegistry([handler('write_story'), handler('write_story')]),
    ).toThrow('write_story');
  });
});
