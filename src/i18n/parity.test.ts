import { describe, expect, it } from 'vitest';
import de from './de.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
// `it` is vitest's; the Italian catalogue is `italian`.
import italian from './it.json';

/**
 * The five locale files agreed with each other before this test existed, but only by
 * luck — nothing checked them. A key present in `en.json` and missing elsewhere does not
 * crash: `useTranslations` falls back to English, so the miss ships silently and the first
 * report comes from a customer reading English in a German dashboard.
 *
 * This is the dashboard's version of the project rule in CLAUDE.md ("i18n is
 * all-or-nothing"), scaled to the five locales this app ships rather than the product's 84.
 */

type Tree = Record<string, unknown>;

function flatten(node: Tree, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value as Tree, path)
      : [path];
  });
}

const LOCALES: Record<string, Tree> = { en, it: italian, es, de, fr };
const REFERENCE = flatten(en).sort();

describe('locale key parity', () => {
  it('ships a non-trivial catalogue, so an empty file cannot pass this test', () => {
    expect(REFERENCE.length).toBeGreaterThan(500);
  });

  for (const [name, tree] of Object.entries(LOCALES)) {
    it(`${name} has exactly the keys en has`, () => {
      const keys = flatten(tree).sort();
      expect(keys.filter((k) => !REFERENCE.includes(k))).toEqual([]);
      expect(REFERENCE.filter((k) => !keys.includes(k))).toEqual([]);
    });

    it(`${name} leaves no value blank`, () => {
      // A blank string is worse than a missing key: the fallback never fires, so the UI
      // renders nothing at all where a label should be.
      const blanks = flatten(tree).filter((path) => {
        const value = path.split('.').reduce<unknown>((node, part) => (node as Tree)?.[part], tree);
        return typeof value === 'string' && value.trim() === '';
      });
      expect(blanks).toEqual([]);
    });
  }

  it('translates the phone errors rather than echoing English', () => {
    // The specific regression this guards: adding a key to en.json and pasting the same
    // English into the other four "for now".
    const paths = [
      'phone.error.sourceLanguageRequired',
      'phone.error.targetLanguageRequired',
      'phone.error.tierRequired',
    ];
    for (const path of paths) {
      const read = (tree: Tree) =>
        path.split('.').reduce<unknown>((node, part) => (node as Tree)?.[part], tree);
      for (const name of ['it', 'es', 'de', 'fr']) {
        expect(read(LOCALES[name]), `${name} ${path}`).not.toBe(read(en));
      }
    }
  });
});
