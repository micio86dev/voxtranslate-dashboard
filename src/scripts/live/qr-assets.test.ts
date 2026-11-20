import { afterEach, describe, expect, it, vi } from 'vitest';

const toDataURL = vi.fn(async (_url: string, _o?: unknown) => 'data:image/png;base64,QRPNG');
const toString = vi.fn(async (_url: string, _o?: unknown) => '<svg>qr</svg>');
vi.mock('qrcode', () => ({ toDataURL, toString }));

const addImage = vi.fn();
const setProperties = vi.fn();
const output = vi.fn(() => new Blob(['%PDF-fake'], { type: 'application/pdf' }));
const jsPDF = vi.fn(function () {
  return { addImage, setProperties, output };
});
vi.mock('jspdf', () => ({ jsPDF }));

import {
  dataUrlToBlob,
  deskFileBase,
  downloadBlob,
  makeDeskPdf,
  makeDeskPng,
  makeDeskSvg,
  renderPrintSheet,
  wrapLines,
  type SheetTexts,
} from './qr-assets';

const URL_SECRET = 'https://app.example.test/d/abc.def-secret-mac';
const texts: SheetTexts = {
  name: 'Front desk',
  location: 'Milan, ground floor',
  instruction: 'Scan to talk to us in your language.',
};

afterEach(() => vi.clearAllMocks());

describe('deskFileBase', () => {
  it('makes a safe ASCII file name from a desk name', () => {
    expect(deskFileBase('Front Desk')).toBe('front-desk');
    expect(deskFileBase('  Caffè  Città / Piano 2 ')).toBe('caffe-citta-piano-2');
  });
  it('falls back to "desk" when nothing usable is left, and caps the length', () => {
    expect(deskFileBase('東京')).toBe('desk');
    expect(deskFileBase('')).toBe('desk');
    expect(deskFileBase('a'.repeat(100)).length).toBe(40);
    expect(deskFileBase('---')).toBe('desk');
  });
});

describe('makeDeskPng / makeDeskSvg', () => {
  it('asks qrcode for a print-quality PNG with a quiet zone', async () => {
    const png = await makeDeskPng(URL_SECRET);
    expect(png).toBe('data:image/png;base64,QRPNG');
    const [url, opts] = toDataURL.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe(URL_SECRET);
    expect(opts).toMatchObject({ width: 1024, margin: 2, errorCorrectionLevel: 'M' });
  });

  it('asks qrcode for an SVG string', async () => {
    const svg = await makeDeskSvg(URL_SECRET);
    expect(svg).toBe('<svg>qr</svg>');
    expect(toString.mock.calls[0][1]).toMatchObject({ type: 'svg', margin: 2 });
  });
});

describe('wrapLines', () => {
  // A fake context where every character is 10px wide.
  const ctx = {
    measureText: (s: string) => ({ width: s.length * 10 }),
  } as CanvasRenderingContext2D;

  it('breaks on words to fit the width', () => {
    expect(wrapLines(ctx, 'one two three four', 80)).toEqual(['one two', 'three', 'four']);
  });
  it('keeps short text on one line and empty text on none', () => {
    expect(wrapLines(ctx, 'hi', 80)).toEqual(['hi']);
    expect(wrapLines(ctx, '   ', 80)).toEqual([]);
  });
  it('breaks a long unspaced word (CJK, URLs) by character', () => {
    expect(wrapLines(ctx, 'abcdefghij', 40)).toEqual(['abcd', 'efgh', 'ij']);
  });
});

describe('renderPrintSheet', () => {
  function fakeEnv() {
    const calls: string[] = [];
    const fillTexts: string[] = [];
    const drawn: unknown[][] = [];
    const ctx = {
      fillStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
      fillRect: (...a: number[]) => calls.push(`fillRect ${a.join(',')}`),
      fillText: (s: string) => fillTexts.push(s),
      drawImage: (...a: unknown[]) => drawn.push(a),
      measureText: (s: string) => ({ width: s.length * 10 }),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toDataURL: () => 'data:image/png;base64,SHEET',
    };
    const image = { id: 'img' };
    return {
      env: {
        createCanvas: () => canvas as unknown as HTMLCanvasElement,
        loadImage: vi.fn(async () => image as unknown as HTMLImageElement),
      },
      canvas,
      ctx,
      fillTexts,
      drawn,
      calls,
      image,
    };
  }

  it('draws an A4 sheet: white page, name, location, the QR and the instruction', async () => {
    const f = fakeEnv();
    const out = await renderPrintSheet('data:image/png;base64,QRPNG', texts, f.env);
    expect(out).toBe('data:image/png;base64,SHEET');
    expect(f.canvas.width).toBe(1240);
    expect(f.canvas.height).toBe(1754);
    expect(f.calls[0]).toBe('fillRect 0,0,1240,1754');
    expect(f.fillTexts).toContain('Front desk');
    expect(f.fillTexts).toContain('Milan, ground floor');
    expect(f.fillTexts.join(' ')).toContain('Scan to talk');
    expect(f.drawn).toHaveLength(1);
    expect(f.drawn[0][0]).toBe(f.image);
    expect(f.env.loadImage).toHaveBeenCalledWith('data:image/png;base64,QRPNG');
  });

  it('skips the location line when there is none', async () => {
    const f = fakeEnv();
    await renderPrintSheet('data:x', { ...texts, location: '' }, f.env);
    expect(f.fillTexts).not.toContain('');
    expect(f.fillTexts).toContain('Front desk');
  });

  it('fails clearly when the canvas cannot be used', async () => {
    const env = {
      createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
      loadImage: async () => ({}) as HTMLImageElement,
    };
    await expect(renderPrintSheet('data:x', texts, env)).rejects.toThrow('canvas_unavailable');
  });
});

describe('makeDeskPdf', () => {
  it('puts the sheet on a single A4 page and returns a PDF blob', async () => {
    const render = vi.fn(async (_png: string, _t: SheetTexts) => 'data:image/png;base64,SHEET');
    const blob = await makeDeskPdf(URL_SECRET, texts, { render });
    expect(blob.type).toBe('application/pdf');
    expect(jsPDF).toHaveBeenCalledWith(expect.objectContaining({ format: 'a4', unit: 'mm' }));
    expect(addImage).toHaveBeenCalledWith('data:image/png;base64,SHEET', 'PNG', 0, 0, 210, 297);
    expect(render.mock.calls[0][1]).toEqual(texts);
  });

  it('never leaks the URL into the PDF metadata or the sheet text', async () => {
    const render = vi.fn(async (_png: string, t: SheetTexts) => {
      expect(JSON.stringify(t)).not.toContain('secret');
      return 'data:image/png;base64,SHEET';
    });
    await makeDeskPdf(URL_SECRET, texts, { render });
    expect(JSON.stringify(setProperties.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(addImage.mock.calls)).not.toContain('secret');
  });
});

// jsdom's Blob has no arrayBuffer()/text().
const readBuffer = (b: Blob) =>
  new Promise<ArrayBuffer>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.readAsArrayBuffer(b);
  });

describe('dataUrlToBlob', () => {
  it('decodes a base64 PNG data URL into a blob of the right type and bytes', async () => {
    const b = dataUrlToBlob('data:image/png;base64,AQID');
    expect(b.type).toBe('image/png');
    expect(b.size).toBe(3);
    expect(Array.from(new Uint8Array(await readBuffer(b)))).toEqual([1, 2, 3]);
  });
  it('decodes a plain (percent-encoded) data URL', async () => {
    const b = dataUrlToBlob('data:image/svg+xml,%3Csvg%2F%3E');
    expect(b.type).toBe('image/svg+xml');
    expect(new TextDecoder().decode(await readBuffer(b))).toBe('<svg/>');
  });
});

describe('downloadBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('clicks a temporary link with the right file name, then removes it', () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: vi.fn() });
    const seen: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push(this.download, this.href);
    });
    downloadBlob(new Blob(['x'], { type: 'image/svg+xml' }), 'front-desk-qr.svg');
    expect(click).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['front-desk-qr.svg', 'blob:fake']);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('releases the object URL afterwards', () => {
    vi.useFakeTimers();
    const revoked = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: revoked });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBlob(new Blob(['x']), 'a.png');
    expect(revoked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoked).toHaveBeenCalledWith('blob:fake');
  });
});
