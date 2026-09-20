/** Node preload for historical smoke scripts that hard-code the Windows Edge path.
 * Only normalizes that executable path; does not modify assertions or browser security.
 * Usage: node --import ./scripts/smoke-browser.mjs scripts/grid-smoke.mjs
 */
import { chromium } from 'playwright-core';
const legacyEdge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const launch = chromium.launch.bind(chromium);
chromium.launch = (options = {}) => launch({
  ...options,
  ...(options.executablePath === legacyEdge
    ? { executablePath: process.env.TB_BROWSER ?? chromium.executablePath() }
    : {}),
});
