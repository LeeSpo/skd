import type { ReactNode } from 'react';

export function interleaveContextMenuSections(
  sections: Array<ReactNode[] | false | null | undefined>,
  renderSeparator: (key: string) => ReactNode,
): ReactNode[] {
  const visible = sections.filter(
    (section): section is ReactNode[] => Array.isArray(section) && section.length > 0,
  );

  return visible.flatMap((items, index) =>
    index === 0 ? items : [renderSeparator(String(index)), ...items],
  );
}
