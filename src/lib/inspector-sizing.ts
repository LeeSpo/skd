/** Pixel band for the right inspector, as a percentage of the main column. */
const MIN_PX = 280;
const MAX_PX = 420;
const MIN_PERCENT_CAP = 40;
const MAX_PERCENT_CAP = 50;

/**
 * `savedWindowPercent` is the stored share of the whole window.
 * The panel itself is a share of the main column, so convert first, then
 * clamp into 280–420px without letting a narrow window give the inspector
 * more than half of that column.
 */
export function inspectorSizing(
  mainColumnWidth: number,
  savedWindowPercent: number,
  workspaceShare: number,
) {
  const width = Number.isFinite(mainColumnWidth) && mainColumnWidth > 0 ? mainColumnWidth : 0;
  const share = Number.isFinite(workspaceShare) && workspaceShare > 0 ? workspaceShare : 100;
  const savedInner = Number.isFinite(savedWindowPercent)
    ? savedWindowPercent / share * 100
    : (MIN_PERCENT_CAP + MAX_PERCENT_CAP) / 2;

  if (width === 0) {
    const size = Math.min(MAX_PERCENT_CAP, Math.max(MIN_PERCENT_CAP, savedInner));
    return { minSize: MIN_PERCENT_CAP, maxSize: MAX_PERCENT_CAP, size };
  }

  const minSize = Math.min(MIN_PERCENT_CAP, MIN_PX / width * 100);
  const maxSize = Math.max(minSize, Math.min(MAX_PERCENT_CAP, MAX_PX / width * 100));
  const size = Math.min(maxSize, Math.max(minSize, savedInner));
  return { minSize, maxSize, size };
}
