import { expect, it } from 'vitest';
import addressparser from 'nodemailer/lib/addressparser';

// Keep the installed mail parser aligned with the intended RFC 5322 recipient.
// These are synthetic parser-only fixtures: no transport or real mail is used.
it.each([
  ['nested comment (GHSA-8c8m-p3m8-cjg8)', 'Victim (x(y) <evil@example.test>) <v@victim.test>', ['v@victim.test']],
  ['group comment (GHSA-m943-m63m-w62w)', 'G: (a; <evil@example.test>) <v@victim.test>;', ['v@victim.test']],
  ['quoted group display name', 'G: "a;" "<evil@example.test>" <v@victim.test>;', ['v@victim.test']],
  ['quoted local part (GHSA-85x2-q946-cp5h)', '<"a@evil.test>"@good.test>', ['"a@evil.test>"@good.test']],
  ['ordinary recipients', 'Alice <alice@example.test>, bob@example.test', ['alice@example.test', 'bob@example.test']],
])('preserves recipient identity for %s', (_label, input, expected) => {
  expect(addressparser(input, { flatten: true }).map(recipient => recipient.address)).toEqual(expected);
});
