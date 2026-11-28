import { emailConfirms } from './email-confirmation';

const EMAIL = 'anna@example.ru';

describe('emailConfirms', () => {
  it.each([
    ['the exact address', 'anna@example.ru', EMAIL],
    ['another case in the typed text', 'Anna@Example.RU', EMAIL],
    ['another case in the account address', 'anna@example.ru', 'Anna@Example.ru'],
    ['spaces around the typed text', '  anna@example.ru  ', EMAIL],
    ['spaces around the account address', 'anna@example.ru', ' anna@example.ru '],
  ])('accepts %s', (_name, typed, email) => {
    expect(emailConfirms(typed, email)).toBe(true);
  });

  it.each([
    ['nothing typed', '', EMAIL],
    ['only spaces', '   ', EMAIL],
    ['a part from the start', 'anna@example.r', EMAIL],
    ['a part from the end', 'nna@example.ru', EMAIL],
    ['an extra character after', 'anna@example.ruu', EMAIL],
    ['an extra character before', 'aanna@example.ru', EMAIL],
    ['a space inside', 'anna @example.ru', EMAIL],
    ['another address', 'oleg@example.ru', EMAIL],
    ['an empty field and an empty address', '', ''],
    ['an empty field and a blank address', '', '   '],
    ['spaces and a blank address', '  ', '   '],
    ['an empty field and no address', '', null],
    ['a typed address and no address', EMAIL, null],
    ['the word null and no address', 'null', null],
  ])('refuses %s', (_name, typed, email) => {
    expect(emailConfirms(typed, email)).toBe(false);
  });
});
