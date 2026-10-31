import {
  ER_LOCK_DEADLOCK,
  ER_LOCK_WAIT_TIMEOUT,
  isLockContention,
} from './lock-errors';

describe('isLockContention', () => {
  it('recognises a lock wait timeout (1205) and a deadlock (1213), as Sequelize wraps them', () => {
    expect(ER_LOCK_WAIT_TIMEOUT).toBe(1205);
    expect(ER_LOCK_DEADLOCK).toBe(1213);
    expect(isLockContention({ parent: { errno: 1205 } })).toBe(true);
    expect(isLockContention({ original: { errno: 1213 } })).toBe(true);
    expect(isLockContention({ errno: 1205 })).toBe(true);
  });

  it('anything else is not contention', () => {
    expect(isLockContention({ parent: { errno: 1062 } })).toBe(false);
    expect(isLockContention({ parent: { errno: '1205' } })).toBe(false);
    expect(isLockContention(new Error('Lock wait timeout exceeded'))).toBe(
      false,
    );
    expect(isLockContention(null)).toBe(false);
    expect(isLockContention('1213')).toBe(false);
  });
});
