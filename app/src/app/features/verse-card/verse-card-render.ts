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
  /** false: mushaf glyphs in one ink colour instead of the tajweed colours. */
  tajweed?: boolean;
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
  mono: boolean,
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
      // The QCF fonts paint the tajweed colours themselves (COLR). For plain text, draw them on a
      // separate layer and recolour every painted pixel with the ink (keeps the anti-aliasing).
      const layer = mono ? document.createElement('canvas') : null;
      if (layer) {
        layer.width = ctx.canvas.width;
        layer.height = Math.ceil(lines.length * lh);
      }
      const c = layer?.getContext('2d') ?? ctx;
      const y0 = layer ? 0 : top;
      // The ayah-number ornament keeps its own colours in plain mode (recoloured it is a blot).
      const ornaments: { code: string; family: string; x: number; y: number }[] = [];
      for (const k of [c, ctx]) {
        k.fillStyle = color;
        k.textBaseline = 'middle';
        k.textAlign = 'right';
      }
      lines.forEach(([s, e], li) => {
        let lw = 0;
        for (let i = s; i < e; i++) lw += widths[i]! + (i > s ? gap : 0);
        let xr = cx + lw / 2;
        const y = y0 + li * lh + lh / 2;
        for (let i = s; i < e; i++) {
          const g = glyphs[i]!;
          if (layer && g.end) ornaments.push({ code: g.code, family: g.family, x: xr, y: top + li * lh + lh / 2 });
          else {
            c.font = `${size}px '${g.family}'`;
            c.fillText(g.code, xr, y);
          }
          xr -= widths[i]! + gap;
        }
      });
      if (layer) {
        c.globalCompositeOperation = 'source-in';
        c.fillStyle = color;
        c.fillRect(0, 0, layer.width, layer.height);
        ctx.drawImage(layer, 0, top);
        for (const o of ornaments) {
          ctx.font = `${size}px '${o.family}'`;
          ctx.fillText(o.code, o.x, o.y);
        }
      }
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

/** What goes behind the text: a drawn background or the user's own photo (cover-fit). */
export type CardBackdrop =
  | { draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }
  | { image: CanvasImageSource & { width: number; height: number } };

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Hex colour with alpha (0..1). */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Draws the card; returns the canvas. Fonts must already be loaded (document.fonts).
 * Without a backdrop: theme paper with the braided band. With one: the backdrop full bleed and the
 * text on a translucent paper panel so it stays readable on any picture.
 */
export async function renderVerseCard(
  content: CardContent,
  colors: CardColors,
  format: CardFormat,
  backdrop: CardBackdrop | null = null,
): Promise<HTMLCanvasElement> {
  const { w: W, h: H } = CARD_SIZE[format];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Backdrop: margin around the panel (the picture shows there); the panel shrinks to the text.
  const P = 96;
  let inset: number;
  if (backdrop) {
    if ('draw' in backdrop) backdrop.draw(ctx, W, H);
    else drawCover(ctx, backdrop.image, W, H);
    inset = P + 30;
  } else {
    ctx.fillStyle = colors.surround;
    ctx.fillRect(0, 0, W, H);
    const m = 34;
    ctx.fillStyle = colors.paper;
    ctx.fillRect(m, m, W - 2 * m, H - 2 * m);
    const t = 40;
    await drawBand(ctx, colors.frame, m + 18, m + 18, W - 2 * (m + 18), H - 2 * (m + 18), t);
    inset = m + 18 + t;
  }

  const cx = W / 2;
  const maxW = W - 2 * (inset + 56);
  const titleH = 120;
  const footH = 150;
  let top = inset + 40;
  let bottom = H - (inset + 30);
  let avail = bottom - top - titleH - footH;

  // Largest sizes whose blocks fit the space between title and footer.
  let ar: Block | null = null;
  let tr: Block | null = null;
  const gapBetween = 56;
  for (let k = 0; k <= 20; k++) {
    // Short ayat get large glyphs; long ones shrink until they fit.
    const arSize = 90 - k * 3;
    const trSize = Math.round(Math.max(24, 42 - k * 1.1));
    ar = content.glyphs.length
      ? glyphBlock(ctx, content.glyphs, arSize, maxW, cx, colors.ink, content.tajweed === false)
      : content.arabic
        ? textBlock(ctx, content.arabic, AR_FALLBACK, arSize * 0.8, 1.9, maxW, cx, colors.ink, true)
        : null;
    tr = content.translation
      ? textBlock(ctx, content.translation, UI_FONT, trSize, 1.5, maxW, cx, colors.ink)
      : null;
    const total = (ar?.height ?? 0) + (tr?.height ?? 0) + (ar && tr ? gapBetween : 0);
    if (total <= avail) break;
  }

  if (backdrop) {
    // Panel just tall enough for the text, centred; long ayat still use the full height.
    const body = (ar?.height ?? 0) + (tr?.height ?? 0) + (ar && tr ? gapBetween : 0);
    avail = Math.min(avail, body + 40);
    const panelH = 40 + titleH + avail + footH + 30 + 24;
    const py = Math.max(P, (H - panelH) / 2);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = withAlpha(colors.paper, 0.72);
    roundRect(ctx, P, py, W - 2 * P, panelH, 34);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = withAlpha(colors.frame, 0.5);
    ctx.lineWidth = 2;
    roundRect(ctx, P + 16, py + 16, W - 2 * (P + 16), panelH - 32, 24);
    ctx.stroke();
    top = py + 30 + 40;
    bottom = top + titleH + avail + footH;
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
