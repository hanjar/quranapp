/**
 * Backgrounds for the verse image, drawn in code (no photos, no licences, any size). Each one is
 * deterministic: a seeded random generator, so the preview and the shared file look the same.
 */

export interface CardBackground {
  id: string;
  label: string;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function linear(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function fill(ctx: CanvasRenderingContext2D, style: string | CanvasGradient, w: number, h: number) {
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, w, h);
}

/** Soft out-of-focus light discs. */
function bokeh(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, colors: string[], n: number, rMin: number, rMax: number) {
  const r = rng(seed);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = rMin + r() * (rMax - rMin);
    ctx.globalAlpha = 0.12 + r() * 0.28;
    ctx.fillStyle = radial(ctx, x, y, rad, [
      [0, colors[i % colors.length]!],
      [0.7, colors[i % colors.length]!],
      [1, 'rgba(255,255,255,0)'],
    ]);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A simple leaf (two bezier halves) at (x, y), pointing along `angle`. */
function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, angle: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.3, -len * 0.28, len * 0.75, -len * 0.22, len, 0);
  ctx.bezierCurveTo(len * 0.75, len * 0.22, len * 0.3, len * 0.28, 0, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = len * 0.015;
  ctx.beginPath();
  ctx.moveTo(len * 0.05, 0);
  ctx.lineTo(len * 0.92, 0);
  ctx.stroke();
  ctx.restore();
}

/** A branch of leaves from a corner. */
function branch(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, scale: number, seed: number, blur: number) {
  const r = rng(seed);
  ctx.save();
  ctx.filter = `blur(${blur}px)`;
  ctx.strokeStyle = '#3d5e22';
  ctx.lineWidth = 6 * scale;
  ctx.beginPath();
  ctx.moveTo(x, y);
  const ex = x + Math.cos(dir) * 520 * scale;
  const ey = y + Math.sin(dir) * 520 * scale;
  ctx.quadraticCurveTo((x + ex) / 2 + 60 * scale, (y + ey) / 2 - 40 * scale, ex, ey);
  ctx.stroke();
  for (let i = 1; i <= 9; i++) {
    const t = i / 10;
    const px = x + (ex - x) * t;
    const py = y + (ey - y) * t;
    const side = i % 2 ? 1 : -1;
    const shade = ['#4e8a2a', '#5f9e33', '#3f7322', '#77b442'][Math.floor(r() * 4)]!;
    leaf(ctx, px, py, (150 + r() * 90) * scale * (1 - t * 0.35), dir + side * (0.6 + r() * 0.5), shade);
  }
  ctx.restore();
}

export const CARD_BACKGROUNDS: readonly CardBackground[] = [
  {
    id: 'daun',
    label: 'Daun pagi',
    draw: (ctx, w, h) => {
      fill(ctx, linear(ctx, 0, 0, w, h, [[0, '#cfe8a4'], [0.45, '#8cc25a'], [1, '#3f7a2c']]), w, h);
      fill(ctx, radial(ctx, w * 0.62, h * 0.18, w * 0.9, [[0, 'rgba(255,255,220,0.85)'], [0.35, 'rgba(240,255,190,0.35)'], [1, 'rgba(255,255,255,0)']]), w, h);
      bokeh(ctx, w, h, 11, ['#f6ffd8', '#d9f2a2', '#ffffff'], 40, w * 0.02, w * 0.09);
      branch(ctx, -40, h * 0.04, 0.35, 1.1, 3, 1.5);
      branch(ctx, -60, h * 0.78, -0.25, 1.25, 7, 3);
      branch(ctx, w + 40, h * 0.97, Math.PI + 0.45, 0.9, 9, 5);
    },
  },
  {
    id: 'dinding',
    label: 'Dinding hangat',
    draw: (ctx, w, h) => {
      fill(ctx, linear(ctx, 0, 0, 0, h, [[0, '#f2eee6'], [0.78, '#e9e3d8'], [0.781, '#d9d0c1'], [1, '#cfc4b2']]), w, h);
      // Sunlight through a window falling on the wall.
      ctx.save();
      ctx.filter = 'blur(10px)';
      ctx.fillStyle = 'rgba(255,236,190,0.8)';
      for (const [dx, dy] of [
        [0, 0],
        [0.24, 0],
        [0, 0.17],
        [0.24, 0.17],
      ] as const) {
        ctx.beginPath();
        const x = w * (0.42 + dx);
        const y = h * (0.08 + dy);
        ctx.moveTo(x, y);
        ctx.lineTo(x + w * 0.2, y + h * 0.05);
        ctx.lineTo(x + w * 0.2, y + h * 0.2);
        ctx.lineTo(x, y + h * 0.15);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // A plant shadow in the corner.
      ctx.save();
      ctx.globalAlpha = 0.24;
      branch(ctx, w * 1.02, h * 0.74, Math.PI + 1.15, 1.2, 21, 7);
      ctx.restore();
      fill(ctx, radial(ctx, w * 0.5, h * 0.45, h * 0.75, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(60,40,20,0.18)']]), w, h);
    },
  },
  {
    id: 'senja',
    label: 'Senja',
    draw: (ctx, w, h) => {
      fill(ctx, linear(ctx, 0, 0, 0, h, [[0, '#2b2459'], [0.35, '#a34c6e'], [0.6, '#f08a4b'], [0.75, '#f7c56b'], [1, '#e9a35a']]), w, h);
      fill(ctx, radial(ctx, w * 0.5, h * 0.7, w * 0.6, [[0, 'rgba(255,236,170,0.95)'], [0.15, 'rgba(255,214,140,0.6)'], [1, 'rgba(255,200,120,0)']]), w, h);
      const dune = (y: number, amp: number, color: string, seed: number) => {
        const r = rng(seed);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0, y);
        for (let x = 0; x <= w; x += w / 4) ctx.quadraticCurveTo(x + w / 8, y - amp * (0.5 + r()), x + w / 4, y + amp * (r() - 0.5));
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      };
      dune(h * 0.78, 50, '#b8613e', 1);
      dune(h * 0.85, 70, '#8a3f2c', 2);
      dune(h * 0.93, 60, '#5a2a24', 3);
    },
  },
  {
    id: 'malam',
    label: 'Malam',
    draw: (ctx, w, h) => {
      fill(ctx, linear(ctx, 0, 0, 0, h, [[0, '#070b24'], [0.6, '#16245a'], [1, '#2f3f7a']]), w, h);
      const r = rng(5);
      for (let i = 0; i < 260; i++) {
        ctx.globalAlpha = 0.3 + r() * 0.7;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(r() * w, r() * h * 0.85, r() * 2.2 + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Crescent.
      const cx = w * 0.76;
      const cy = h * 0.12;
      fill(ctx, radial(ctx, cx, cy, 220, [[0, 'rgba(255,240,200,0.35)'], [1, 'rgba(255,240,200,0)']]), w, h);
      ctx.fillStyle = '#fbf1cf';
      ctx.beginPath();
      ctx.arc(cx, cy, 70, 0, Math.PI * 2);
      ctx.fill();
      // The dark part of the crescent: a disc in the sky's colour there.
      ctx.fillStyle = '#0b1233';
      ctx.beginPath();
      ctx.arc(cx + 30, cy - 18, 62, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: 'laut',
    label: 'Laut teduh',
    draw: (ctx, w, h) => {
      fill(ctx, linear(ctx, 0, 0, 0, h, [[0, '#bfe3f2'], [0.55, '#e9f6f8'], [0.551, '#5fb0c4'], [1, '#1f6f8b']]), w, h);
      fill(ctx, radial(ctx, w * 0.3, h * 0.5, w * 0.5, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]), w, h);
      const r = rng(8);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 60; i++) {
        const y = h * (0.57 + r() * 0.42);
        const x = r() * w;
        ctx.lineWidth = 1 + r() * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 40 + r() * 140, y);
        ctx.stroke();
      }
      bokeh(ctx, w, h * 0.5, 4, ['#ffffff'], 12, 30, 90);
    },
  },
  {
    id: 'marmer',
    label: 'Marmer',
    draw: (ctx, w, h) => {
      fill(ctx, linear(ctx, 0, 0, w, h, [[0, '#f7f5f0'], [1, '#e7e2d8']]), w, h);
      const r = rng(13);
      ctx.save();
      for (let i = 0; i < 26; i++) {
        ctx.filter = `blur(${r() * 2}px)`;
        ctx.strokeStyle = `rgba(${120 + r() * 40},${110 + r() * 30},${100 + r() * 30},${0.15 + r() * 0.3})`;
        ctx.lineWidth = 0.6 + r() * 3;
        let x = r() * w;
        let y = -50;
        ctx.beginPath();
        ctx.moveTo(x, y);
        while (y < h + 50) {
          const nx = x + (r() - 0.45) * 160;
          const ny = y + 80 + r() * 120;
          ctx.quadraticCurveTo(x + (r() - 0.5) * 120, (y + ny) / 2, nx, ny);
          x = nx;
          y = ny;
        }
        ctx.stroke();
      }
      ctx.restore();
    },
  },
  {
    id: 'geometri',
    label: 'Geometri',
    draw: (ctx, w, h) => {
      fill(ctx, linear(ctx, 0, 0, 0, h, [[0, '#f3ead6'], [1, '#e6d7b6']]), w, h);
      // Eight-pointed stars (two overlapping squares) on a grid.
      const s = 120;
      ctx.strokeStyle = 'rgba(150,110,40,0.35)';
      ctx.lineWidth = 2.5;
      for (let y = -s; y < h + s; y += s) {
        for (let x = (y / s) % 2 ? -s / 2 : -s; x < w + s; x += s) {
          for (const rot of [0, Math.PI / 4]) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.strokeRect(-s * 0.32, -s * 0.32, s * 0.64, s * 0.64);
            ctx.restore();
          }
        }
      }
      fill(ctx, radial(ctx, w / 2, h / 2, h * 0.7, [[0, 'rgba(243,234,214,0.6)'], [1, 'rgba(243,234,214,0)']]), w, h);
    },
  },
  {
    id: 'catair',
    label: 'Cat air',
    draw: (ctx, w, h) => {
      fill(ctx, '#fbf7f1', w, h);
      const r = rng(17);
      ctx.save();
      ctx.filter = 'blur(60px)';
      const colors = ['#f6c9c4', '#c9e3f2', '#f4e1b0', '#cfe7cf', '#e2cdea'];
      for (let i = 0; i < 9; i++) {
        ctx.globalAlpha = 0.55 + r() * 0.35;
        ctx.fillStyle = colors[i % colors.length]!;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 180 + r() * 260, 140 + r() * 220, r() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  },
];
