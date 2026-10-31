import { utcDatetime } from './datetime';
import { escapeLike, LIKE_ESCAPE, likeContains, likePrefix } from './like';
import { idOrNull, moneyOrNull, toBool, toCount } from './values';

describe('LIKE escaping (escape character "!")', () => {
  it('escapes %, _ and the escape character itself; leaves everything else alone', () => {
    expect(escapeLike('100%')).toBe('100!%');
    expect(escapeLike('Blue_Kurti')).toBe('Blue!_Kurti');
    expect(escapeLike('a!b')).toBe('a!!b');
    expect(escapeLike('%_!')).toBe('!%!_!!');
    // Backslash and quotes are not LIKE wildcards: the value is a bound replacement, quoting is the driver's job.
    expect(escapeLike(String.raw`C:\x'y"`)).toBe(String.raw`C:\x'y"`);
    expect(escapeLike('')).toBe('');
  });

  it('prefix and contains patterns wrap the escaped text', () => {
    expect(likePrefix('KUR%')).toBe('KUR!%%');
    expect(likeContains('_')).toBe('%!_%');
    expect(likeContains('red kurti')).toBe('%red kurti%');
  });

  it('the SQL fragment names the same escape character', () => {
    expect(LIKE_ESCAPE).toBe(`ESCAPE '!'`);
  });
});

describe('utcDatetime', () => {
  it('formats a Date as a UTC DATETIME(3) literal, independent of the machine time zone', () => {
    expect(utcDatetime(new Date('2026-10-31T18:29:59.999Z'))).toBe(
      '2026-10-31 18:29:59.999',
    );
    expect(utcDatetime(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)))).toBe(
      '2026-01-02 03:04:05.006',
    );
  });
});

describe('raw value readers', () => {
  it('money stays the exact decimal string; null stays null; a number is refused', () => {
    expect(moneyOrNull('775.70')).toBe('775.70');
    expect(moneyOrNull('-0.01')).toBe('-0.01');
    expect(moneyOrNull(null)).toBeNull();
    expect(moneyOrNull(undefined)).toBeNull();
    expect(() => moneyOrNull(775.7)).toThrow('not returned as a string');
  });

  it('counts accept numbers and numeric strings (SUM of a boolean is DECIMAL text)', () => {
    expect(toCount(3)).toBe(3);
    expect(toCount('4')).toBe(4);
    expect(toCount(null)).toBe(0);
    expect(() => toCount('1.5')).toThrow();
    expect(() => toCount(-1)).toThrow();
  });

  it('booleans from TINYINT(1)', () => {
    expect([
      toBool(1),
      toBool(0),
      toBool(true),
      toBool('1'),
      toBool(null),
    ]).toEqual([true, false, true, true, false]);
  });

  it('ids as strings', () => {
    expect(idOrNull(12)).toBe('12');
    expect(idOrNull('9007199254740993')).toBe('9007199254740993');
    expect(idOrNull(null)).toBeNull();
  });
});
