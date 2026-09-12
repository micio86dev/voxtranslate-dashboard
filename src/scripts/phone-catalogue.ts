/**
 * Dialer catalogue: what the phone dialer is allowed to offer, and what it must refuse
 * (spec 0112, R1/R2).
 *
 * The dialer shipped in 1.50.0 with its language and tier selects declared in markup and
 * never populated. Because `select.value` is `''` rather than `undefined`, the `?? 'en'`
 * fallback never fired and **every call carried an empty language**. This module exists so
 * that the two decisions that caused it — which options may be offered, and whether a
 * request is complete — are pure, named, and tested rather than inlined in a page script.
 *
 * Two server catalogues feed it, each for what it alone knows:
 *
 * - `GET /api/engines` — which engines exist, what they cost, and the language codes each
 *   one can take in and emit.
 * - `GET /api/languages` — how those codes are named, grouped and ordered (`engine/
 *   langmap.rs` over an embedded `languages.json`, cached an hour).
 *
 * Naming a language here exactly as the call app names it is deliberate: the customer
 * already learned that word in the room, and a second vocabulary for the same thing is a
 * bug report waiting to happen.
 */

import { numberProblem } from './phone-dialer';

/** One language as `GET /api/languages` describes it. */
export interface LanguageMeta {
  code: string;
  native: string;
  english: string;
  region: string;
  rtl: boolean;
  flag: string;
}

/** The `GET /api/languages` payload, minus the tier map the engines already carry. */
export interface LanguageCatalogue {
  languages: LanguageMeta[];
  regions: string[];
}

/** One engine as `GET /api/engines` describes it. Never carries the raw cost or markup. */
export interface EngineOption {
  id: string;
  display_name: string;
  tier: string;
  rate_per_minute: number;
  input_languages: string[];
  output_languages: string[];
}

/** A ready-to-render `<option>`. */
export interface LanguageOption {
  code: string;
  label: string;
  region: string;
  rtl: boolean;
}

/** A ready-to-render `<optgroup>`. */
export interface LanguageGroup {
  region: string;
  options: LanguageOption[];
}

/**
 * How a language is written in a picker: flag, its own name, then the English name when
 * that adds something.
 *
 * The English name is not decoration — it is what makes the list searchable for someone
 * who knows the language by its English name but not its native spelling. Repeating it
 * when the two agree ("English — English") is noise on the entry most people scan for.
 */
export function languageLabel(meta: LanguageMeta): string {
  const head = `${meta.flag} ${meta.native}`.trim();
  return meta.english && meta.english !== meta.native ? `${head} — ${meta.english}` : head;
}

/**
 * The options a select may offer, given the language codes the chosen engine declares.
 *
 * Intersected both ways on purpose. A code the engine claims but the catalogue cannot name
 * would render as a blank option; a language the catalogue knows but the engine does not
 * speak would let the user pick something the call will refuse — which is the failure this
 * module exists to prevent, and it only shows up after the money has been held.
 *
 * An engine that declares nothing yields nothing. Falling back to the whole catalogue here
 * would look like a helpful default and would re-introduce exactly that bug.
 */
export function languageOptions(
  catalogue: LanguageCatalogue,
  allowed: readonly string[],
): LanguageOption[] {
  const permitted = new Set(allowed);
  return catalogue.languages
    .filter((l) => permitted.has(l.code))
    .map((l) => ({
      code: l.code,
      label: languageLabel(l),
      region: l.region,
      rtl: l.rtl,
    }));
}

/**
 * The same options grouped into `<optgroup>`s, in the catalogue's declared region order.
 *
 * The order is the server's, not alphabetical: `languages.json` lists regions the way the
 * call app's picker groups them, and two pickers that sort the same list differently read
 * as two different products.
 */
export function groupedLanguageOptions(
  catalogue: LanguageCatalogue,
  allowed: readonly string[],
): LanguageGroup[] {
  const options = languageOptions(catalogue, allowed);
  return catalogue.regions
    .map((region) => ({ region, options: options.filter((o) => o.region === region) }))
    .filter((g) => g.options.length > 0);
}

/** The tier select's options, in the order the server returned them. */
export function tierOptions(engines: readonly EngineOption[]): EngineOption[] {
  return [...engines];
}

/**
 * Look an engine up by id.
 *
 * Returns `null` rather than falling back to the first engine: a silent fallback would
 * place the call on a tier the user did not choose and bill them for it.
 */
export function engineById(
  engines: readonly EngineOption[],
  id: string | null | undefined,
): EngineOption | null {
  if (!id) return null;
  return engines.find((e) => e.id === id) ?? null;
}

/** Which side of the engine a language selection belongs to. */
export type LanguageDirection = 'input' | 'output';

/**
 * Whether a selected language survives a change of engine.
 *
 * The caller's language is checked against what the engine can *hear* and the recipient's
 * against what it can *speak*. The two lists are equal on every engine shipped today, and
 * writing it as one check would be a trap the first time they are not.
 */
export function keepLanguage(
  engine: EngineOption | null,
  code: string | null | undefined,
  direction: LanguageDirection,
): boolean {
  if (!engine || !code) return false;
  const list = direction === 'input' ? engine.input_languages : engine.output_languages;
  return list.includes(code);
}

/** A dial request as the dialer assembles it, before it is sent. */
export interface DialDraft {
  destination: string;
  sourceLanguage: string;
  targetLanguage: string;
  engineId: string;
  projectId: string | null;
}

export interface DialContext {
  engines: readonly EngineOption[];
  requireProject: boolean;
}

/** The field to focus, and the i18n key that says what is wrong with it. */
export interface DialProblem {
  field: 'destination' | 'source' | 'target' | 'tier' | 'project';
  key: string;
}

/**
 * The last gate before a dial leaves the browser. `null` means "send it".
 *
 * Order matters and mirrors the server's own (`policy::check`, and
 * `a_number_that_is_not_e164_is_refused_before_anything_else`): the number first, then the
 * tier, then the languages that depend on it. Reporting a language problem on a number
 * that cannot be dialled sends the user to fix the wrong field.
 *
 * This is a convenience, not a security boundary — the server validates everything again,
 * and it is the server that spends the money.
 */
export function validateDial(draft: DialDraft, ctx: DialContext): DialProblem | null {
  const badNumber = numberProblem(draft.destination);
  if (badNumber) return { field: 'destination', key: `phone.reason.${badNumber}` };

  const engine = engineById(ctx.engines, draft.engineId);
  if (!engine) return { field: 'tier', key: 'phone.error.tierRequired' };

  if (!draft.sourceLanguage) {
    return { field: 'source', key: 'phone.error.sourceLanguageRequired' };
  }
  if (!keepLanguage(engine, draft.sourceLanguage, 'input')) {
    return { field: 'source', key: 'phone.error.languageNotInTier' };
  }

  if (!draft.targetLanguage) {
    return { field: 'target', key: 'phone.error.targetLanguageRequired' };
  }
  if (!keepLanguage(engine, draft.targetLanguage, 'output')) {
    return { field: 'target', key: 'phone.error.languageNotInTier' };
  }

  if (ctx.requireProject && !draft.projectId) {
    return { field: 'project', key: 'phone.error.projectRequired' };
  }

  return null;
}

/** The shape `GET …/voip/numbers` returns, narrowed to what a caller-id choice needs. */
export interface CallerIdCandidate {
  e164: string;
  label: string | null;
  is_default: boolean;
  outbound_enabled: boolean;
  verification_status: string;
}

/**
 * The organisation's numbers that may actually be presented as caller id.
 *
 * `resolve_caller_id` on the server refuses anything that is not both verified and
 * outbound-enabled, so offering one here would produce a refusal *after* the user had
 * chosen it. The same rule, stated early enough to be useful.
 *
 * Presenting an unverified number is illegal in most of our markets, which is why the
 * check is on `verification_status` and not on a label someone typed.
 */
export function usableCallerIds<T extends CallerIdCandidate>(numbers: readonly T[]): T[] {
  return numbers.filter((n) => n.outbound_enabled && n.verification_status === 'verified');
}

// ---- contacts (spec 0114) --------------------------------------------------

/** One of a contact's numbers, narrowed to what choosing one needs. */
export interface ContactNumber {
  e164: string;
  label?: string | null;
  language?: string | null;
  is_primary?: boolean;
}

/**
 * The language spoken on a specific number.
 *
 * On the NUMBER, never on the person — a colleague in Barcelona who takes work calls in
 * English on the office line and Catalan on their mobile is one contact, and asking the
 * contact would be wrong half the time.
 *
 * `null` when the number carries no language, which the dialer must treat as "still ask"
 * rather than as a default. Guessing here would put a stranger's call in the wrong
 * language, and the caller would not find out until nobody understood anybody.
 */
export function languageForNumber(numbers: readonly ContactNumber[], e164: string): string | null {
  return numbers.find((n) => n.e164 === e164)?.language ?? null;
}

/** The number to offer first: the one marked primary, else the first there is. */
export function primaryNumber<T extends ContactNumber>(numbers: readonly T[]): T | null {
  if (numbers.length === 0) return null;
  return numbers.find((n) => n.is_primary) ?? numbers[0];
}

/**
 * Whether a finished call should offer to keep the number.
 *
 * Only once it is over. Asking somebody to file a contact mid-conversation is asking them
 * to stop listening — and a call that is still ringing may yet reach a person the address
 * book knows under a different number.
 *
 * A failed call still gets the offer: a wrong number is exactly the one worth fixing and
 * keeping.
 */
export function shouldOfferSave(call: { status: string; contact_id: string | null }): boolean {
  if (call.contact_id) return false;
  return call.status === 'completed' || call.status === 'failed';
}
