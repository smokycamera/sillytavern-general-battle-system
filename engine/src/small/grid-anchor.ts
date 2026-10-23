/** Saved compass anchors keep their original geometry; numbered anchors are independent fourths. */
export const COMPASS_ANCHORS = ['north', 'south', 'east', 'west', 'north_east', 'north_west', 'south_east', 'south_west', 'center'] as const;
export const GRID_ANCHORS = ['A1', 'B1', 'C1', 'D1', 'A2', 'B2', 'C2', 'D2', 'A3', 'B3', 'C3', 'D3', 'A4', 'B4', 'C4', 'D4'] as const;
export type GridAnchor = typeof GRID_ANCHORS[number];

export function gridPosition(anchor: string): [number, number] | undefined {
  return /^[A-D][1-4]$/.test(anchor) ? [anchor.charCodeAt(0) - 65, Number(anchor[1]) - 1] : undefined;
}
export function gridBounds(anchor: string, width: number, height: number): [number, number, number, number] | undefined {
  const at = gridPosition(anchor);
  if (!at) return;
  const [x, y] = at;
  return [Math.round(width * x / 4), Math.round(width * (x + 1) / 4) - 1,
    Math.round(height * y / 4), Math.round(height * (y + 1) / 4) - 1];
}
export function inGridSector(anchor: string, width: number, height: number, x: number, y: number): boolean {
  const b = gridBounds(anchor, width, height);
  return !b || x >= b[0] - .5 && x < b[1] + .5 && y >= b[2] - .5 && y < b[3] + .5;
}
/** Large cities occupy an edge or the central area, not a single small numbered cell. */
export function compassSector(anchor: string): string {
  const at = gridPosition(anchor);
  if (!at) return anchor;
  const [x, y] = at, vertical = y === 0 ? 'north' : y === 3 ? 'south' : '', horizontal = x === 0 ? 'west' : x === 3 ? 'east' : '';
  return [vertical, horizontal].filter(Boolean).join('_') || 'center';
}
export function oppositeGrid(anchor: string): GridAnchor | undefined {
  const at = gridPosition(anchor);
  return at ? `${String.fromCharCode(68 - at[0])}${4 - at[1]}` as GridAnchor : undefined;
}
