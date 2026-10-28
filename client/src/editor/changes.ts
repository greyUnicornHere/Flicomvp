/** How a step or connection appears in an AI change preview. */
export type Change = 'added' | 'modified' | 'removed';

export const CHANGE_BADGE: Record<Change, string> = { added: '+ Added', modified: '↗ Updated', removed: '− Removed' };
