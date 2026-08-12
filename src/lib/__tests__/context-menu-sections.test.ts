import { describe, expect, it } from 'vitest';
import { interleaveContextMenuSections } from '../context-menu-sections';

describe('interleaveContextMenuSections', () => {
  const renderSeparator = (key: string) => `sep:${key}`;

  it('returns an empty list when every group is empty', () => {
    expect(interleaveContextMenuSections([[], [], false, null], renderSeparator)).toEqual([]);
  });

  it('returns a single group with no separator', () => {
    expect(interleaveContextMenuSections([['Delete']], renderSeparator)).toEqual(['Delete']);
  });

  it('inserts one separator between two real groups', () => {
    expect(
      interleaveContextMenuSections([['Copy', 'Cut'], ['Delete']], renderSeparator),
    ).toEqual(['Copy', 'Cut', 'sep:1', 'Delete']);
  });

  it('collapses empty groups between real groups into a single separator', () => {
    expect(
      interleaveContextMenuSections(
        [['Copy'], [], ['Delete']],
        renderSeparator,
      ),
    ).toEqual(['Copy', 'sep:1', 'Delete']);
  });

  it('ignores leading and trailing empty groups', () => {
    expect(
      interleaveContextMenuSections(
        [false, [], ['Rename'], null, undefined, ['Delete'], []],
        renderSeparator,
      ),
    ).toEqual(['Rename', 'sep:1', 'Delete']);
  });

  it('renders the local multi-select shape as Delete only', () => {
    expect(
      interleaveContextMenuSections([[], [], ['Delete']], renderSeparator),
    ).toEqual(['Delete']);
  });
});
