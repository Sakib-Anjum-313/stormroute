/** Where a popover box goes relative to its map anchor: above, flipped below near the top edge. */
export interface Placement {
  left: number
  top: number
  below: boolean
}

export const POPOVER_GAP = 14
export const POPOVER_MARGIN = 8

export function placePopover(
  anchor: { x: number; y: number },
  box: { width: number; height: number },
  container: { width: number; height: number },
): Placement {
  const maxLeft = Math.max(POPOVER_MARGIN, container.width - box.width - POPOVER_MARGIN)
  const left = Math.min(maxLeft, Math.max(POPOVER_MARGIN, anchor.x - box.width / 2))
  const above = anchor.y - POPOVER_GAP - box.height
  const below = above < POPOVER_MARGIN
  const top = below
    ? Math.min(
        anchor.y + POPOVER_GAP,
        Math.max(POPOVER_MARGIN, container.height - box.height - POPOVER_MARGIN),
      )
    : above
  return { left, top, below }
}
