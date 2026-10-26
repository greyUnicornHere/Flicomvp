import { describe, expect, it } from 'vitest';
import { filterWorkflows, sortByModified } from './workflows';

const items = [
  { name: 'Invoice Approval', updatedAt: '2026-10-24T10:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' },
  { name: 'Customer   onboarding', updatedAt: '2026-10-26T10:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' },
  { name: 'Vendor management', updatedAt: '2026-10-25T10:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' },
];

describe('filterWorkflows', () => {
  it('returns everything for an empty or blank query', () => {
    expect(filterWorkflows(items, '')).toBe(items);
    expect(filterWorkflows(items, '   ')).toBe(items);
  });
  it('matches substrings case-insensitively and tolerates extra spaces', () => {
    expect(filterWorkflows(items, 'APPROV').map((i) => i.name)).toEqual(['Invoice Approval']);
    expect(filterWorkflows(items, ' customer onboarding ').map((i) => i.name)).toEqual(['Customer   onboarding']);
    expect(filterWorkflows(items, 'n').map((i) => i.name)).toHaveLength(3);
  });
  it('keeps the original order', () => {
    expect(filterWorkflows(items, 'o').map((i) => i.name)).toEqual(items.filter((i) => /o/i.test(i.name)).map((i) => i.name));
  });
});

describe('sortByModified', () => {
  it('orders most recently modified first without mutating the input', () => {
    const sorted = sortByModified(items);
    expect(sorted.map((i) => i.name)).toEqual(['Customer   onboarding', 'Vendor management', 'Invoice Approval']);
    expect(items[0]!.name).toBe('Invoice Approval');
  });
});
