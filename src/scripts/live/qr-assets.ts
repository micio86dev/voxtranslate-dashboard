/**
 * The printable assets of a desk QR: PNG, SVG and a one-page A4 PDF.
 *
 * Everything is generated in the browser from the desk's URL, which is the credential: it goes
 * into the QR and nowhere else. It is never put in text, a file name, PDF metadata, the console
 * or a page — only the code that encodes it ever holds it.
 *
 * `qrcode` and `jspdf` are lazy chunks: a page that never downloads a QR never loads them.
 * The PDF page is drawn on a canvas first and placed as one image, so a desk name in any
 * script (Cyrillic, CJK, Arabic) prints as typed — jsPDF's built-in fonts cannot do that.
 */

const QR_OPTS = { margin: 2, errorCorrectionLevel: 'M' as const };

/** An ASCII, filesystem-safe base name for a desk's downloads. */
export function deskFileBase(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'desk';
}

/** A print-quality PNG data URL (1024 px, with a quiet zone). */
export async function makeDeskPng(url: string): Promise<string> {
  const { toDataURL } = await import('qrcode');
  return toDataURL(url, { ...QR_OPTS, width: 1024 });
}

/** The QR as an SVG document string. */
export async function makeDeskSvg(url: string): Promise<string> {
  const { toString } = await import('qrcode');
  return toString(url, { ...QR_OPTS, type: 'svg' });
}

export interface SheetTexts {
  name: string;
  location: string;
  instruction: string;
}

/** Greedy word wrap; a word wider than the line (CJK, a long URL) is broken by character. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  const fits = (s: string) => ctx.measureText(s).width <= maxWidth;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    let rest = word;
    while (!fits(rest)) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

const SHEET_W = 1240; // A4 at 150 dpi
const SHEET_H = 1754;

export interface SheetEnv {
  createCanvas: () => HTMLCanvasElement;
  loadImage: (src: string) => Promise<HTMLImageElement>;
}

const browserEnv: SheetEnv = {
  createCanvas: () => document.createElement('canvas'),
  loadImage: (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('qr_image_failed'));
      img.src = src;
    }),
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

/** Draws the A4 sheet (desk name, location, big QR, instruction) and returns it as a PNG data URL. */
export async function renderPrintSheet(
  qrPng: string,
  texts: SheetTexts,
  env: SheetEnv = browserEnv,
): Promise<string> {
  const canvas = env.createCanvas();
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  const qr = await env.loadImage(qrPng);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  let y = 170;
  ctx.font = `700 76px ${FONT}`;
  for (const line of wrapLines(ctx, texts.name, SHEET_W - 200).slice(0, 2)) {
    ctx.fillText(line, SHEET_W / 2, y);
    y += 92;
  }
  if (texts.location) {
    ctx.fillStyle = '#475569';
    ctx.font = `400 44px ${FONT}`;
    for (const line of wrapLines(ctx, texts.location, SHEET_W - 200).slice(0, 2)) {
      ctx.fillText(line, SHEET_W / 2, y + 10);
      y += 58;
    }
  }

  const size = 880;
  ctx.drawImage(qr, (SHEET_W - size) / 2, y + 90, size, size);
  y += 90 + size + 80;

  ctx.fillStyle = '#0f172a';
  ctx.font = `500 46px ${FONT}`;
  for (const line of wrapLines(ctx, texts.instruction, SHEET_W - 260).slice(0, 3)) {
    ctx.fillText(line, SHEET_W / 2, y);
    y += 62;
  }
  return canvas.toDataURL('image/png');
}

export interface PdfDeps {
  render?: (qrPng: string, texts: SheetTexts) => Promise<string>;
}

/** A single printable A4 page. */
export async function makeDeskPdf(
  url: string,
  texts: SheetTexts,
  deps: PdfDeps = {},
): Promise<Blob> {
  const [qrPng, { jsPDF }] = await Promise.all([makeDeskPng(url), import('jspdf')]);
  const sheet = await (deps.render ?? renderPrintSheet)(qrPng, texts);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  pdf.setProperties({ title: deskFileBase(texts.name) });
  pdf.addImage(sheet, 'PNG', 0, 0, 210, 297);
  return pdf.output('blob');
}

/**
 * A `data:` URL as a Blob, decoded by hand: `fetch(dataUrl)` would be refused by the page's
 * CSP, whose `connect-src` does not list `data:`.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const type = /^data:([^;,]+)/.exec(meta)?.[1] ?? 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  if (!meta.includes(';base64')) return new Blob([decodeURIComponent(body)], { type });
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Saves a blob under `filename` through a temporary link, then releases it. */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}
