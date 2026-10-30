import { changedFields } from './audit.service';

describe('changedFields', () => {
  const current = {
    displayName: 'Shop A',
    meeshoSupplierId: null as string | null,
    status: 'active',
  };

  it('keeps only fields whose value changes', () => {
    expect(
      changedFields(current, { displayName: 'Shop B', status: 'active' }),
    ).toEqual({
      before: { displayName: 'Shop A' },
      after: { displayName: 'Shop B' },
    });
  });

  it('treats null as a real value (clearing a field is a change)', () => {
    expect(
      changedFields<typeof current>(
        { ...current, meeshoSupplierId: 'SUP-1' },
        { meeshoSupplierId: null },
      ),
    ).toEqual({
      before: { meeshoSupplierId: 'SUP-1' },
      after: { meeshoSupplierId: null },
    });
  });

  it('ignores undefined (field not sent) and reports nothing for a no-op', () => {
    expect(
      changedFields(current, { displayName: undefined, status: 'active' }),
    ).toEqual({ before: {}, after: {} });
  });
});
