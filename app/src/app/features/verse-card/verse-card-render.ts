import { bandCorner, bandH, bandV } from '../../core/band-tiles';
import { CARD_SIZE, CardFormat, GlyphWord, splitWords, wrap } from './verse-card-layout';

export interface CardColors {
  paper: string;
  surround: string;
  frame: string;
  ink: string;
  accent: string;
}

export interface CardContent {
  /** "Al-Baqarah · Ayat 255" */
  title: string;
  /** "QS. Al-Baqarah [2]: 255" */
  reference: string;
  /** Mushaf glyphs (QCF); empty when the fonts could not be loaded. */
  glyphs: GlyphWord[];
  /** Fallback Arabic text (Kemenag) when there are no glyphs. */
  arabic: string | null;
  translation: string | null;
  footer: string;
  credit: string;
}

const UI_FONT = "'Mf Read Poppins', Poppins, system-ui, sans-serif";
const AR_FALLBACK = "'Amiri Quran', 'Amiri', 'Noto Naskh Arabic', 'Scheherazade New', serif";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** Braided band on all four sides of the rectangle (x, y, w, h), band thickness t. */
async function drawBand(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
): Promise<void> {
  const [hImg, vImg, cImg] = await Promise.all([
    loadImage(bandH(color)),
    loadImage(bandV(color)),
    loadImage(bandCorner(color)),
  ]);
  const runH = w - 2 * t;
  const nH = Math.max(1, Math.round(runH / (2 * t)));
  const stepH = runH / nH;
  for (let i = 0; i < nH; i++) {
    ctx.drawImage(hImg, x + t + i * stepH, y, stepH, t);
    ctx.drawImage(hImg, x + t + i * stepH, y + h - t, stepH, t);
  }
  const runV = h - 2 * t;
  const nV = Math.max(1, Math.round(runV / (2 * t)));
  const stepV = runV / nV;
  for (let i = 0; i < nV; i++) {
    ctx.drawImage(vImg, x, y + t + i * stepV, t, stepV);
    ctx.drawImage(vImg, x + w - t, y + t + i * stepV, t, stepV);
  }
  for (const [cx, cy] of [
    [x, y],
    [x + w - t, y],
    [x, y + h - t],
    [x + w - t, y + h - t],
  ] as const)
    ctx.drawImage(cImg, cx, cy, t, t);
}

interface Block {
  height: number;
  draw: (top: number) => void;
}

/** Arabic as mushaf glyphs, centred lines, right to left. */
function glyphBlock(
  ctx: CanvasRenderingContext2D,
  glyphs: GlyphWord[],
  size: number,
  maxW: number,
  cx: number,
  color: string,
): Block {
  const gap = size * 0.18;
  const widths = glyphs.map((g) => {
    ctx.font = `${size}px '${g.family}'`;
    return ctx.measureText(g.code).width;
  });
  const lines = wrap(widths, maxW, gap);
  const lh = size * 1.75;
  return {
    height: lines.length * lh,
    draw: (top) => {
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      lines.forEach(([s, e], li) => {
        let lw = 0;
        for (let i = s; i < e; i++) lw += widths[i]! + (i > s ? gap : 0);
        let xr = cx + lw / 2;
        const y = top + li * lh + lh / 2;
        for (let i = s; i < e; i++) {
          ctx.font = `${size}px '${glyphs[i]!.family}'`;
          ctx.fillText(glyphs[i]!.code, xr, y);
          xr -= widths[i]! + gap;
        }
      });
    },
  };
}

/** Plain text block (Arabic fallback or translation), centred, wrapped by words. */
function textBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  size: number,
  lineHeight: number,
  maxW: number,
  cx: number,
  color: string,
  rtl = false,
): Block {
  ctx.font = `${size}px ${font}`;
  const words = splitWords(text);
  const space = ctx.measureText(' ').width;
  const widths = words.map((w) => ctx.measureText(w).width);
  const lines = wrap(widths, maxW, space).map(([s, e]) => words.slice(s, e).join(' '));
  const lh = size * lineHeight;
  return {
    height: lines.length * lh,
    draw: (top) => {
      ctx.font = `${size}px ${font}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = rtl ? 'rtl' : 'ltr';
      lines.forEach((l, i) => ctx.fillText(l, cx, top + i * lh + lh / 2));
      ctx.direction = 'ltr';
    },
  };
}

/** Draws the card; returns the canvas. Fonts must already be loaded (document.fonts). */
export async function renderVerseCard(
  content: CardContent,
  colors: CardColors,
  format: CardFormat,
): Promise<HTMLCanvasElement> {
  const { w: W, h: H } = CARD_SIZE[format];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = colors.surround;
  ctx.fillRect(0, 0, W, H);
  const m = 34;
  ctx.fillStyle = colors.paper;
  ctx.fillRect(m, m, W - 2 * m, H - 2 * m);
  const t = 40;
  await drawBand(ctx, colors.frame, m + 18, m + 18, W - 2 * (m + 18), H - 2 * (m + 18), t);

  const cx = W / 2;
  const maxW = W - 2 * (m + 18 + t + 56);
  const titleH = 120;
  const footH = 150;
  const top = m + 18 + t + 40;
  const bottom = H - (m + 18 + t + 30);
  const avail = bottom - top - titleH - footH;

  // Largest sizes whose blocks fit the space between title and footer.
  let ar: Block | null = null;
  let tr: Block | null = null;
  const gapBetween = 56;
  for (let k = 0; k <= 14; k++) {
    const arSize = Math.round(70 - k * 3);
    const trSize = Math.round(40 - k * 1.2);
    ar = content.glyphs.length
      ? glyphBlock(ctx, content.glyphs, arSize, maxW, cx, colors.ink)
      : content.arabic
        ? textBlock(ctx, content.arabic, AR_FALLBACK, arSize * 0.8, 1.9, maxW, cx, colors.ink, true)
        : null;
    tr = content.translation
      ? textBlock(ctx, content.translation, UI_FONT, trSize, 1.5, maxW, cx, colors.ink)
      : null;
    const total = (ar?.height ?? 0) + (tr?.height ?? 0) + (ar && tr ? gapBetween : 0);
    if (total <= avail) break;
  }

  // Title
  ctx.fillStyle = colors.frame;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 38px ${UI_FONT}`;
  ctx.fillText(content.title, cx, top + 40);
  ctx.fillRect(cx - 60, top + 86, 120, 3);

  // Body, vertically centred
  const bodyH = (ar?.height ?? 0) + (tr?.height ?? 0) + (ar && tr ? gapBetween : 0);
  let y = top + titleH + Math.max(0, (avail - bodyH) / 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top + titleH - 10, W, avail + 20);
  ctx.clip();
  if (ar) {
    ar.draw(y);
    y += ar.height + (tr ? gapBetween / 2 : 0);
  }
  if (ar && tr) {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(cx, y, 5, 0, Math.PI * 2);
    ctx.fill();
    y += gapBetween / 2;
  }
  tr?.draw(y);
  ctx.restore();

  // Footer
  const fy = bottom - footH;
  ctx.fillStyle = colors.frame;
  ctx.font = `600 34px ${UI_FONT}`;
  ctx.fillText(content.reference, cx, fy + 30);
  ctx.fillStyle = colors.ink;
  ctx.globalAlpha = 0.75;
  ctx.font = `28px ${UI_FONT}`;
  ctx.fillText(content.footer, cx, fy + 82);
  ctx.globalAlpha = 0.55;
  ctx.font = `20px ${UI_FONT}`;
  ctx.fillText(content.credit, cx, fy + 124);
  ctx.globalAlpha = 1;
  return canvas;
}
