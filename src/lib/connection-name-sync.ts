export function connectionNameUpdateForHostChange(
  host: string,
  opts: { isNewConnection: boolean; nameManuallyEdited: boolean },
): { name?: string } {
  if (!opts.isNewConnection || opts.nameManuallyEdited) {
    return {};
  }
  return { name: host };
}