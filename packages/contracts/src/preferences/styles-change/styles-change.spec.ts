import { ChangeStylesRequestSchema } from './styles-change';

describe('ChangeStylesRequestSchema', () => {
  it.each([[['history']], [['history', 'facts']], [['facts', 'fairy_tale', 'history']]])(
    'accepts %j',
    (styles) => {
      expect(ChangeStylesRequestSchema.parse({ styles })).toEqual({ styles });
    },
  );

  it('rejects an extra userId key', () => {
    const body = { styles: ['facts'], userId: '11111111-1111-4111-8111-111111111111' };
    expect(ChangeStylesRequestSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['no styles field', {}],
    ['an empty list', { styles: [] }],
    ['a repeated style', { styles: ['facts', 'facts'] }],
    ['an unknown style', { styles: ['poetry'] }],
    ['a wrong type', { styles: 'facts' }],
    ['null', { styles: null }],
  ])('rejects %s', (_label, body) => {
    expect(ChangeStylesRequestSchema.safeParse(body).success).toBe(false);
  });
});
