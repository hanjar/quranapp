/**
 * The braided frame band (same tiles as the page frame in page-view.scss) as SVG markup, recoloured
 * for drawing on a canvas (verse cards). Our own interlace design.
 */
const tile =
  (svg: string) =>
  (color: string): string =>
    'data:image/svg+xml,' + encodeURIComponent(svg.replace(/black/g, color));

/** Horizontal tile, 24x12. */
export const bandH = tile(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='square'><path d='M0 0.8H24M0 11.2H24' stroke-width='1.2'/><path d='M0 3L6 9M6 9L7.94 7.06M10.06 4.94L12 3M12 3L18 9M18 9L19.94 7.06M22.06 4.94L24 3M0 9L1.94 7.06M4.06 4.94L6 3M6 3L12 9M12 9L13.94 7.06M16.06 4.94L18 3M18 3L24 9' stroke-linecap='butt'/></svg>`);
/** Vertical tile, 12x24. */
export const bandV = tile(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='square'><path d='M0.8 0V24M11.2 0V24' stroke-width='1.2'/><path d='M3 0L9 6M9 6L7.06 7.94M4.94 10.06L3 12M3 12L9 18M9 18L7.06 19.94M4.94 22.06L3 24M9 0L7.06 1.94M4.94 4.06L3 6M3 6L9 12M9 12L7.06 13.94M4.94 16.06L3 18M3 18L9 24' stroke-linecap='butt'/></svg>`);
/** Corner knot, 12x12. */
export const bandCorner = tile(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='black' stroke-width='1.2'><rect x='0.8' y='0.8' width='10.4' height='10.4'/><rect x='3.6' y='3.6' width='4.8' height='4.8' transform='rotate(45 6 6)' stroke-width='1.6'/></svg>`);
