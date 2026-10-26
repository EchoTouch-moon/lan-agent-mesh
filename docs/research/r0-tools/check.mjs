/** Offline document contract checks. Uses Ajv already locked by ESLint; no install. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve('eslint'));
const Ajv = eslintRequire('ajv');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const schema = read('docs/research/upstream-locks.schema.json');
const locks = read('docs/research/upstream-locks.json');
const validate = new Ajv({ allErrors: true }).compile(schema);
function check(data) {
  if (!validate(data)) throw new Error(JSON.stringify(validate.errors));
  assert.equal(new Set(data.upstreams.map((x) => x.id)).size, data.upstreams.length);
  for (const item of data.upstreams) {
    for (const key of ['licenseEvidence', 'apiEvidence', 'platformEvidence']) {
      for (const url of item[key]) {
        assert.ok(url.startsWith(`${item.url}/blob/${item.commit}/`), `${item.id}: unpinned ${key}`);
        const path = url.slice(`${item.url}/blob/${item.commit}/`.length);
        assert.ok(item.sourcePaths.includes(path), `${item.id}: source not collected`);
      }
    }
    assert.ok(item.tagOrCommit === item.commit || item.tagOrCommit !== 'latest');
  }
  const c = data.a2aContract;
  assert.deepEqual(c.terminalStates, ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED']);
}
check(locks);
console.log(`PASS lock schema, pinned evidence URLs and license sanity (${locks.upstreams.length} entries)`);
const cases = [
  ['floating source commit', (d) => { d.upstreams[0].commit = 'main'; }],
  ['unknown license promoted', (d) => { d.upstreams[0].license = null; }],
  ['missing license source', (d) => { d.upstreams[0].licenseEvidence = []; }],
  ['mutable API URL', (d) => { d.upstreams[0].apiEvidence[0] = 'https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto'; }],
  ['documentary evidence called verified', (d) => { d.upstreams[0].status = 'verified'; }],
  ['UNKNOWN forged terminal', (d) => { d.a2aContract.terminalStates.push('UNKNOWN'); }],
  ['UNKNOWN mapped to failed', (d) => { d.a2aContract.unknownMapping = 'TASK_STATE_FAILED'; }],
  ['cancel accepted equals terminal', (d) => { d.a2aContract.cancelRequiresNativeTerminal = false; }],
  ['unauthenticated SDK entry', (d) => { d.a2aContract.authenticationBeforeSdk = false; }],
  ['revoked scope continues access', (d) => { d.a2aContract.revocationMustInvalidateCardAndTaskAccess = false; }],
  ['research authorizes runtime', (d) => { d.upstreams[0].runtimeDependencyApproved = true; }]
];
for (const [name, mutate] of cases) {
  const copy = JSON.parse(JSON.stringify(locks));
  mutate(copy);
  assert.throws(() => check(copy), undefined, name);
  console.log(`PASS rejected: ${name}`);
}
console.log('Evidence class: docs contract validation; no auth server, sandbox, Harness or A2A conformance executed.');
console.log(`Validator: Ajv ${eslintRequire('ajv/package.json').version}`);
