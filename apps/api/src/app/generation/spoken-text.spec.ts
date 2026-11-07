import type { StoryStyle } from '@sleep-stories/contracts';
import { composeSpokenText } from './spoken-text';

const BODY = 'Первая строка.\nВторая строка.';

const compose = (title: string, body = BODY, style: StoryStyle = 'history') =>
  composeSpokenText({ style, title, body });

// Everything in square brackets that is left in the output.
const bracketsIn = (text: string) => text.match(/[[\]［］]/g)?.length ?? 0;

describe('composeSpokenText', () => {
  describe('layout', () => {
    it('writes the tag, a blank line, the intro, the pause tag and the body', () => {
      expect(compose('Как пекли хлеб в деревенской печи')).toBe(
        `[storyteller]\n\nИстория "Как пекли хлеб в деревенской печи".\n[pause]\n${BODY}`,
      );
    });

    it.each([
      ['history', 'История'],
      ['fairy_tale', 'Сказка'],
      ['facts', 'Факт'],
    ] as const)('uses the kind word for %s', (style, word) => {
      expect(compose('Название', BODY, style)).toBe(
        `[storyteller]\n\n${word} "Название".\n[pause]\n${BODY}`,
      );
    });
  });

  describe('title punctuation', () => {
    it.each([
      ['Название.', 'История "Название".'],
      ['Название...', 'История "Название..."'],
      ['Название…', 'История "Название…"'],
      ['Название!', 'История "Название!"'],
      ['Почему небо синее?', 'История "Почему небо синее?"'],
      ['Что это было?!', 'История "Что это было?!"'],
      ['Название,', 'История "Название".'],
      ['Название ;: ', 'История "Название".'],
      ['Вопрос?.', 'История "Вопрос?"'],
    ])('%s', (title, intro) => {
      expect(compose(title)).toBe(`[storyteller]\n\n${intro}\n[pause]\n${BODY}`);
    });

    it('keeps the question mark inside the quotes and adds no full stop', () => {
      expect(compose('Почему небо синее?', BODY, 'facts')).toContain('Факт "Почему небо синее?"\n');
    });

    it('removes quote characters inside the title', () => {
      expect(compose('Дом "у реки"')).toContain('История "Дом у реки".\n');
      expect(compose('Дом «у реки»')).toContain('История "Дом у реки".\n');
      expect(compose('Дом “у реки” и „лес“')).toContain('История "Дом у реки и лес".\n');
    });

    it('trims the title and turns whitespace runs and newlines into one space', () => {
      expect(compose('  Дом\n  у   реки \n')).toContain('История "Дом у реки".\n');
    });
  });

  describe('brackets', () => {
    const forged = [
      ['a tag in the title', compose('Дом [whispers] у реки'), 'История "Дом у реки".'],
      ['a tag in the body', compose('Дом', 'Он сказал [laughs] тихо.'), 'Он сказал тихо.'],
    ] as const;

    it.each(forged)('removes %s and adds only our two tags', (_name, output, kept) => {
      expect(bracketsIn(output)).toBe(4);
      expect(output).toContain(kept);
      expect(output).not.toContain('whispers');
      expect(output).not.toContain('laughs');
    });

    it('removes nested, unclosed and fullwidth brackets from the title and the body', () => {
      const output = compose('Дом [[x]] ［y］ [ у ] реки ]', 'Раз [[a]] два ［b］ три [ четыре ] ] [');
      expect(bracketsIn(output)).toBe(4);
      expect(output).toBe('[storyteller]\n\nИстория "Дом реки".\n[pause]\nРаз два три');
    });

    it('leaves an unclosed bracket text without brackets', () => {
      const output = compose('Дом', 'Начало [ конец');
      expect(bracketsIn(output)).toBe(4);
      expect(output.endsWith('\nНачало конец')).toBe(true);
    });

    it('does not delete a long stretch of text between a distant [ and ]', () => {
      const middle = 'слово '.repeat(200).trim();
      const out = composeSpokenText({ style: 'history', title: 'Название', body: `Начало [ ${middle} ] конец` });
      expect(out).toContain(middle);
      expect(out).toContain('Начало');
      expect(out).toContain('конец');
      expect(out.match(/[[\]［］]/g)).toHaveLength(4); // only [storyteller] and [pause]
    });

    it('does not let a bracketed span cross a newline', () => {
      const out = composeSpokenText({ style: 'history', title: 'Название', body: 'Строка [один\nвторая] строка' });
      expect(out).toContain('один\nвторая');
      expect(out.match(/[[\]［］]/g)).toHaveLength(4);
    });

    it('keeps the newlines of the body', () => {
      expect(compose('Дом', 'Раз [x]\n\nдва')).toBe(
        '[storyteller]\n\nИстория "Дом".\n[pause]\nРаз \n\nдва',
      );
    });
  });

  describe('an empty title', () => {
    it.each([[''], ['   '], ['[whispers]'], ['[[a]] ［b］ ['], ['"..."']])(
      'omits the intro and the pause tag (%j)',
      (title) => {
        expect(compose(title)).toBe(`[storyteller]\n\n${BODY}`);
      },
    );
  });

  describe('the body', () => {
    it('is trimmed and otherwise unchanged', () => {
      const body = '\n  Тихая ночь: "над" озером, «в» тишине…\n\nКонец.  \n';
      expect(compose('Дом', body)).toBe(
        `[storyteller]\n\nИстория "Дом".\n[pause]\n${body.trim()}`,
      );
    });
  });
});
