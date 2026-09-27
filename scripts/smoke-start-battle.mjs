import assert from 'node:assert/strict';

/** Exercise the actual confirmation UI when a historical roster starts a new V6 battle. */
export async function startBattle(panel, mode) {
  const start = panel.locator(`[data-action="${mode}-start"]`);
  const idle = () => panel.locator('body:not([aria-busy="true"])').waitFor();
  await start.click(); await idle();
  const accept = panel.locator('[data-action="migration-accept"]');
  if (await accept.count()) {
    assert.match(await panel.locator('[data-role="migration-review"]').innerText(), /升级V6/);
    await accept.click(); await idle();
    await accept.waitFor({ state: 'hidden' });
    await start.click(); await idle();
  }
}
