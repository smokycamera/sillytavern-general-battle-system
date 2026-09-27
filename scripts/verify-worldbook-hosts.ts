/** Targeted compatibility probe. Pass a directory containing downloaded official
 * st-world-info.js, tt-world-info.js, st-context.js, tt-context.js and
 * tt-world-info-entry-prepare.js. No network, full host startup, or battle matrix.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { embeddedWorldbookEntries, installEmbeddedWorldbook } from '../extension/src/embedded-worldbook.js';

const directory = process.argv[2];
assert.ok(directory, 'Pass the official host-source directory');
const entries = embeddedWorldbookEntries();
const foreign = { ...entries[0]!, world: 'foreign', uid: 90, order: 2.5, depth: 1, comment: 'foreign rule', content: 'FOREIGN_RULE' };
const results: object[] = [];
for (const hostName of ['st', 'tt']) {
  const source = readFileSync(path.join(directory, `${hostName}-world-info.js`), 'utf8');
  const contextSource = readFileSync(path.join(directory, `${hostName}-context.js`), 'utf8');
  for (const api of ['eventTypes: event_types', 'extensionSettings: extension_settings', 'saveSettingsDebounced', 'setExtensionPrompt']) assert.ok(contextSource.includes(api), `${hostName}: ${api}`);
  const parsed = ts.createSourceFile('world-info.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functionText = (name: string) => {
    const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, `${hostName}: ${name}`);
    return node.getText(parsed).replace(/^export\s+/, '');
  };
  const start = source.indexOf('const WIBeforeEntries = []');
  const end = source.indexOf('const worldInfoBefore =', start);
  assert.ok(start > 0 && end > start, 'Locate actual host prompt-assembly block');
  const assembly = source.slice(start, end);
  for (const strategy of [0, 1, 2]) {
    let subscription: ((...args: unknown[]) => void) | undefined;
    let installed = false;
    let useEmbedded = false;
    const port = {
      inject() { throw Error('Native host must not use separate extension prompts'); },
      clearInjection() {},
      subscribe(_kind: string, callback: (...args: unknown[]) => void) {
        subscription = callback; installed = true;
        return { available: true, stop() { subscription = undefined; installed = false; } };
      },
    };
    const sandbox = vm.createContext({
      structuredClone, console: { debug() {}, log() {}, error(error: unknown) { throw error; }, warn() {} },
      world_info_character_strategy: strategy,
      world_info_insertion_strategy: { evenly: 0, character_first: 1, global_first: 2 },
      sortFn: (a: { order: number }, b: { order: number }) => b.order - a.order,
      getGlobalLore: async () => structuredClone([foreign, ...(useEmbedded ? [] : entries)]),
      getCharacterLore: async () => [{ ...foreign, world: 'character', uid: 91, content: 'CHARACTER_RULE' }],
      getChatLore: async () => [], getPersonaLore: async () => [],
      event_types: { WORLDINFO_ENTRIES_LOADED: 'worldinfo' },
      eventSource: { emit: async (_event: string, payload: unknown) => { if (useEmbedded) subscription?.(payload); } },
      parseDecorators: (content: string) => [[], content], getStringHash: () => 0,
      selected_world_info: [], collectCharacterWorldsToSearch: () => ({ worldsToSearch: [] }),
      chat_metadata: {}, METADATA_KEY: 'world_info', power_user: {}, prefetchWorldInfos: async () => {},
      world_info_position: { before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6, outlet: 7 },
      DEFAULT_DEPTH: 4, extension_prompt_roles: { SYSTEM: 0 }, regex_placement: { WORLD_INFO: 5 },
      // Verify both modes traverse the host's WI regex path identically.
      getRegexedString: (content: string) => content.replace('FOREIGN_RULE', 'FILTERED_RULE'),
    });
    if (hostName === 'tt') {
      const helper = readFileSync(path.join(directory, 'tt-world-info-entry-prepare.js'), 'utf8').replace('export function', 'function');
      vm.runInContext(helper + '\n' + functionText('collectWorldInfoEntries'), sandbox);
    }
    vm.runInContext(functionText('getSortedEntries'), sandbox);
    const sorted = async () => vm.runInContext('getSortedEntries()', sandbox) as Promise<object[]>;
    const prompt = (values: object[]) => {
      sandbox.allActivatedEntries = new Map(values.map((entry, index) => [index, entry]));
      return JSON.stringify(vm.runInContext(`(() => { ${assembly}\n return WIDepthEntries; })()`, sandbox));
    };
    const baseline = prompt(await sorted());
    useEmbedded = true;
    let stop = installEmbeddedWorldbook(port);
    assert.equal(stop.mode, 'native');
    assert.equal(prompt(await sorted()), baseline, `${hostName} strategy ${strategy}: original vs built-in prompt`);
    stop(); assert.equal(installed, false);
    stop = installEmbeddedWorldbook(port, { entries: { '0': 'EDITED_RULE' } });
    assert.ok(prompt(await sorted()).includes('EDITED_RULE'));
    stop(); stop = installEmbeddedWorldbook(port, { enabled: false });
    const disabled = prompt(await sorted());
    assert.ok(!disabled.includes('<battle_contract>'));
    assert.ok(disabled.includes('FILTERED_RULE'));
    stop();
    results.push({ host: hostName, strategy, originalEqualsEmbedded: true, edit: true, disable: true, cleanup: true });
  }
  const bytes = Buffer.from(source);
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  console.log(`${hostName} world-info blob ${blob}: 3 strategy comparisons passed`);
}
console.log(JSON.stringify({ cases: results, limitations: 'Host functions executed with stubbed I/O and all four rules activated; no live ST/TT UI or budget-exhaustion simulation.' }, null, 2));
