import { decideSeedTarget } from '../../../prisma/seed-target';

// This spec sits under src/ only because Jest collects src/** (the seed itself
// lives in apps/api/prisma).
describe('decideSeedTarget', () => {
  const local = 'postgresql://u:p@127.0.0.1:54322/postgres';
  const remote = 'postgresql://u:p@db.invalid:5432/x';

  it.each([
    ['127.0.0.1', local],
    ['localhost', 'postgresql://u:p@localhost:54322/postgres'],
    ['[::1]', 'postgresql://u:p@[::1]:54322/postgres'],
  ])('treats %s as local, with or without the remote opt-in', (_label, url) => {
    expect(decideSeedTarget({ url, allowRemote: undefined })).toEqual({ kind: 'local' });
    expect(decideSeedTarget({ url, allowRemote: 'yes' })).toEqual({ kind: 'local' });
  });

  it('refuses a remote host unless SEED_ALLOW_REMOTE is exactly "yes"', () => {
    expect(decideSeedTarget({ url: remote, allowRemote: undefined })).toEqual({ kind: 'refused' });
    for (const value of ['', 'no', 'true', '1', 'YES', ' yes']) {
      expect(decideSeedTarget({ url: remote, allowRemote: value })).toEqual({ kind: 'refused' });
    }
    expect(decideSeedTarget({ url: remote, allowRemote: 'yes' })).toEqual({ kind: 'remote' });
  });

  it('treats a URL that merely mentions a loopback host as remote', () => {
    expect(decideSeedTarget({ url: 'postgresql://127.0.0.1@db.invalid/x', allowRemote: undefined })).toEqual({
      kind: 'refused',
    });
    expect(decideSeedTarget({ url: remote + '?host=127.0.0.1', allowRemote: undefined })).toEqual({ kind: 'refused' });
  });

  it('does not treat a loopback URL with a host override parameter as local', () => {
    for (const parameter of ['host=db.invalid', 'hostaddr=10.0.0.1', 'HOST=db.invalid', '%68ost=db.invalid']) {
      const url = `${local}?${parameter}`;
      expect(decideSeedTarget({ url, allowRemote: undefined })).toEqual({ kind: 'refused' });
      expect(decideSeedTarget({ url, allowRemote: 'yes' })).toEqual({ kind: 'remote' });
    }
  });

  it('refuses an unparsable URL', () => {
    expect(decideSeedTarget({ url: 'not a url', allowRemote: undefined })).toEqual({ kind: 'refused' });
  });
});
