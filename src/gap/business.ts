/**
 * The Business pane, for the three things on it Apple's official API cannot answer: the state
 * of each agreement, the warnings App Store Connect shows on the account, and the compliance
 * forms Apple wants per app.
 *
 * Checked against specification **4.5.1** (1,001 paths, 1,473 schemas) on 2026-10-27:
 * `contract`, `compliance`, `bank`, `banking`, `legalEntit`, `seller`, `wwdr`, `program` and
 * `membership` match no path and no schema. `agreement` matches twelve paths, all of them
 * `betaLicenseAgreements` or `endUserLicenseAgreements` — the TestFlight tester agreement and
 * the customer EULA, neither the Paid or Free Applications agreement. `medical` occurs only as
 * an age-rating field and an app category, and `TRADER_STATUS_*` only as territory-availability
 * reasons, which `official/availability.ts` already reads. Nothing official says an agreement
 * is waiting to be accepted, that banking is not set up, or that an app owes a form.
 *
 * `/ci/api` comes nearest, with one boolean — `wwdr_pla_needs_signing` — and it is a different
 * question: in the 2026-10-27 recordings the Paid Applications agreement had a newer version
 * waiting, with a deadline on the current one, and no field there can express either.
 *
 * All three are reads, on bases that cannot carry anything else — see `RA` and `PPM` in
 * `http.ts`. The writes recorded beside them are legal filings and are not mapped.
 *
 * **The contracting legal entity is never read.** Each agreement arrives with the entity's
 * name, postal address, phone number and sanctions-screening results. None of that is carried,
 * so none of it can reach stdout, a log, or a caller. The one thing kept about the entity is
 * the opaque id Apple scopes a compliance requirement to it by.
 */

import { PPM, RA, request } from './http';
import { record, segment, teamOf, text } from './parse';
import { Session } from './session';

/**
 * A value Apple was expected to send, refused rather than defaulted.
 *
 * The rule `gap/ci.ts` follows, for the same reason: an absent `isInEffect` is not an
 * agreement out of effect, an absent list of warnings is not an account with none, and an
 * absent status is not a requirement that has been met.
 */
function missing(what: string): Error {
  return new Error(
    `App Store Connect did not send ${what}. This is a private endpoint with no schema behind ` +
      'it, so a changed response is a real possibility — re-capture the Business page. How ' +
      'these bases answer a dead session was never recorded, so check "asc status" as well.'
  );
}

function flag(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw missing(`whether ${what}`);
  return value;
}

function required(value: unknown, what: string): string {
  const given = text(value);
  if (given === undefined) throw missing(what);
  return given;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw missing(what);
  return value;
}

/** Strings only, from a list Apple sends, where a non-string entry carries nothing to show. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
}

/**
 * A notice App Store Connect shows: a severity and a key into its own string table.
 *
 * Both are passed through. The severities recorded are `info`, `warning` and `error`; the keys
 * are localisation keys — `PPM.banking.bankingAccount.setup.message` — rather than prose,
 * because the prose lives in the page's string table and is not an API.
 */
export interface Notice {
  type: string;
  messageKey: string;
}

function readNotice(entry: unknown, where: string): Notice {
  const source = record(entry);
  if (!source) throw missing(`a readable entry in ${where}`);
  return {
    type: required(source['type'], `a type on an entry in ${where}`),
    messageKey: required(source['messageKey'], `a messageKey on an entry in ${where}`),
  };
}

/**
 * One agreement, reduced to whether it is in force and what is waiting on it.
 *
 * From `GET ra/v1/contentProviders/{team}/agreements`. Of the response's 35 keys per
 * agreement, these are the ones that answer that question; the territory lists, the term
 * documents and the contracting legal entity are not carried.
 */
export interface Agreement {
  contractId: string;
  /** Apple's `contractDisplayName` — "Paid Applications", "Free Applications". */
  name: string;
  /**
   * Apple's status, verbatim. A localisation key — `ITC.ATB.Agmnt.Status.Active`,
   * `…PendingUserInfo`, `…PendingUserInfoNewAgreementAvailable` are the three recorded — so
   * it is a string rather than a union and is never compared against a literal.
   */
  status: string;
  inEffect: boolean;
  /**
   * Apple's `configIsLatestVersion`. `false` means a newer version of the agreement is
   * waiting to be accepted: in the one recording where it was, `configValidUntilDate` was set
   * beside it and the view action was `AgreeToTerms`.
   */
  latestVersion: boolean;
  /** Apple's `configValidUntilDate`: the deadline on the current version, where there is one. */
  currentVersionValidUntil?: string;
  expiresSoon: boolean;
  preGracePeriod: boolean;
  postGracePeriod: boolean;
  /** ISO 8601 instants, as sent. */
  effectiveDate?: string;
  expirationDate?: string;
  /**
   * What the page offers to do about it, as Apple's localisation keys — every entry under
   * `applicableActions`, whichever of `view`, `edit`, `setup` or `extLink` it came from.
   * Empty on an agreement that is simply in force.
   */
  actions: string[];
}

export interface Agreements {
  agreements: Agreement[];
  /** The notices Apple sends beside the list, about the agreements as a whole. */
  notices: Notice[];
}

function readAgreement(entry: unknown): Agreement {
  const source = record(entry);
  const contractId = text(source?.['contractId']);
  if (!source || !contractId) throw missing('a contractId on an agreement');

  // Each list is refused rather than filtered: an action list Apple reshaped, read as empty,
  // is an agreement reported as needing nothing.
  const offered = record(source['applicableActions']);
  if (!offered) throw missing(`the applicable actions on agreement ${contractId}`);
  const actions = Object.entries(offered).flatMap(([kind, entries]) => {
    const kept = strings(entries);
    if (!Array.isArray(entries) || kept.length !== entries.length) {
      throw missing(`a list of "${kind}" actions on agreement ${contractId}`);
    }
    return kept;
  });

  const about = (what: string) => `agreement ${contractId} ${what}`;
  return {
    contractId,
    name: text(source['contractDisplayName']) ?? text(source['contractType']) ?? '(unnamed)',
    status: required(source['status'], `a status on agreement ${contractId}`),
    inEffect: flag(source['isInEffect'], about('is in effect')),
    latestVersion: flag(source['configIsLatestVersion'], about('is the latest version')),
    currentVersionValidUntil: text(source['configValidUntilDate']),
    expiresSoon: flag(source['expireSoon'], about('expires soon')),
    preGracePeriod: flag(source['isPreGracePeriod'], about('is in its pre-grace period')),
    postGracePeriod: flag(source['isPostGracePeriod'], about('is in its post-grace period')),
    effectiveDate: text(source['effectiveDate']),
    expirationDate: text(source['expirationDate']),
    actions,
  };
}

/** Every agreement on the team, and what Apple says about them. */
export async function fetchAgreements(session: Session): Promise<Agreements> {
  const path = `contentProviders/${teamOf(session)}/agreements`;
  const data = record(record(await request<unknown>(session, path, { api: RA }))?.['data']);
  if (!data) throw missing('an agreements document');

  return {
    agreements: list(data['agreements'], 'a list of agreements').map(readAgreement),
    notices: list(data['messages'], 'the notices beside the agreements').map((entry) =>
      readNotice(entry, 'the agreement notices')
    ),
  };
}

export function formatAgreements({ agreements, notices }: Agreements): string {
  if (agreements.length === 0) return 'No agreements.';

  const lines: string[] = [];
  for (const agreement of agreements) {
    if (lines.length) lines.push('');
    lines.push(`${agreement.name}`);
    lines.push(`  status     ${agreement.status}`);
    lines.push(`  in effect  ${agreement.inEffect ? 'yes' : 'no'}`);
    if (!agreement.latestVersion) {
      lines.push(
        `  a newer version is waiting to be accepted` +
          (agreement.currentVersionValidUntil ? `; this one is valid until ${agreement.currentVersionValidUntil}` : '')
      );
    }
    if (agreement.expiresSoon) lines.push('  Apple reports it expiring soon');
    if (agreement.preGracePeriod) lines.push('  Apple reports it in its pre-grace period');
    if (agreement.postGracePeriod) lines.push('  Apple reports it in its post-grace period');
    if (agreement.effectiveDate || agreement.expirationDate) {
      lines.push(`  term       ${agreement.effectiveDate ?? '?'} to ${agreement.expirationDate ?? '?'}`);
    }
    for (const action of agreement.actions) lines.push(`  action     ${action}`);
  }

  if (notices.length) {
    lines.push('', 'Apple says:');
    for (const notice of notices) lines.push(`  ${notice.type.padEnd(8)} ${notice.messageKey}`);
  }

  return lines.join('\n');
}

/**
 * The `ppm` account a team's payments and compliance live under.
 *
 * `GET ppm/v1/accountLookup/teamTypes/ITC/teamIds/{team}`, exactly as the browser makes it
 * before every other `ppm` call. In every recording the account id it returns is the team id
 * it was given, but that is one account's worth of evidence, so the lookup is made rather
 * than skipped. `ITC` is the browser's literal, not the `X-Connect-Team-Type` value.
 */
async function accountOf(session: Session): Promise<string> {
  const path = `v1/accountLookup/teamTypes/ITC/teamIds/${teamOf(session)}`;
  const body = record(await request<unknown>(session, path, { api: PPM }));
  return segment(required(body?.['accountId'], 'an accountId for this team'), 'payments account id');
}

/**
 * A warning App Store Connect shows on the account. From
 * `GET ppm/v1/accounts/{account}/accountMessages`; the `params` beside each one — a legal
 * entity id and a display flag — are not carried.
 */
export type AccountMessage = Notice;

/** The warnings App Store Connect shows on the account: banking, tax, DSA and the like. */
export async function fetchAccountMessages(session: Session): Promise<AccountMessage[]> {
  const account = await accountOf(session);
  const body = record(await request<unknown>(session, `v1/accounts/${account}/accountMessages`, { api: PPM }));
  return list(body?.['message'], 'a list of account messages').map((entry) =>
    readNotice(entry, 'the account messages')
  );
}

export function formatAccountMessages(messages: AccountMessage[]): string {
  if (messages.length === 0) return 'No account messages.';
  return messages.map((message) => `${message.type.padEnd(8)} ${message.messageKey}`).join('\n');
}

/**
 * A compliance form Apple wants, and from what.
 *
 * From `GET ppm/complianceform/v1/accounts/{account}/requirements`. Apple groups requirements
 * by what they apply to: an app, by its Apple id (`contentId`), or the legal entity as a whole,
 * where it also says in which countries.
 */
export interface ComplianceRequirement {
  scope: 'app' | 'legalEntity';
  /** The app's Apple id, or the legal entity's id. */
  scopeId: string;
  /** Apple's requirement name, verbatim: `MEDICAL_DEVICE` is the one recorded. */
  name: string;
  /** Apple's status, verbatim: `PENDING_COLLECTION` is the one recorded. */
  status: string;
  /** ISO country codes, where Apple scoped the requirement to some. */
  countries: string[];
}

function readGroup(entry: unknown): ComplianceRequirement[] {
  const source = record(entry);
  const appId = text(source?.['contentId']);
  const legalEntityId = text(source?.['legalEntityId']);
  const subject =
    appId !== undefined && legalEntityId === undefined
      ? { scope: 'app' as const, scopeId: appId }
      : legalEntityId !== undefined && appId === undefined
        ? { scope: 'legalEntity' as const, scopeId: legalEntityId }
        : undefined;
  if (!source || !subject) {
    throw missing('exactly one of an app id or a legal entity id on a compliance requirement group');
  }

  const { scope, scopeId } = subject;
  const where = `the compliance requirements for ${scope === 'app' ? `app ${scopeId}` : 'the legal entity'}`;

  return list(source['requirements'], where).map((requirement) => {
    const row = record(requirement);
    if (!row) throw missing(`a readable entry in ${where}`);
    return {
      scope,
      scopeId,
      name: required(row['name'], `a name on an entry in ${where}`),
      status: required(row['status'], `a status on an entry in ${where}`),
      countries: strings(row['countries']),
    };
  });
}

/** The compliance forms Apple is asking the account for, per app and for the legal entity. */
export async function fetchComplianceRequirements(session: Session): Promise<ComplianceRequirement[]> {
  const account = await accountOf(session);
  const body = record(
    await request<unknown>(session, `complianceform/v1/accounts/${account}/requirements`, { api: PPM })
  );
  return list(body?.['requirementData'], 'a list of compliance requirements').flatMap(readGroup);
}

export function formatComplianceRequirements(requirements: ComplianceRequirement[]): string {
  if (requirements.length === 0) return 'No compliance requirements.';
  return requirements
    .map((requirement) => {
      const subject = requirement.scope === 'app' ? `app ${requirement.scopeId}` : 'legal entity';
      const where = requirement.countries.length ? `  in ${requirement.countries.length} countries` : '';
      return `${subject.padEnd(18)} ${requirement.name}  ${requirement.status}${where}`;
    })
    .join('\n');
}
