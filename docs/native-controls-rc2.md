# Native controls and save recovery — 0.2.0-rc.2

The user reported a pending-save loop, delayed controls, and requested a draggable circular swords button, a replacement worldbook, and manual report generation.

## Changes

- Replaced the canonical four-entry worldbook with the uploaded file verbatim. The bundled prompt imports this canonical JSON and the installable asset is copied from it.
- If metadata saving silently returns without changing the independently verified previous disk head, use the host full-chat save once. Explicit errors, changed sessions, competing revisions, and corrupt payloads do not trigger this automatic fallback.
- Manual recovery uses the same stored candidate and operation ID, preferring full-chat saving when available. It does not recompute combat or duplicate rewards.
- Pending status now displays the underlying error instead of suppressing it behind a generic message.
- Identical ordinary panel flushes verify the disk head but skip another write/revision. Explicit operation IDs retain their normal persistence semantics.
- Removed the redundant outer save after report delivery. Navigation, theme switching, and camera movement remain available during writes; mutation commands remain serialized with visible feedback.
- Circular inline SVG swords button supports pointer/touch dragging, a movement threshold, click suppression, saved position, cancellation, and viewport clamping.
- Reports default to durable user messages without automatic generation. The user can click the explicit “发送给 AI” button or use the host send control. Existing drafts and attachments remain untouched.
- Updated both manifests and the package version to rc.2; the panel header displays its running version.

## Validation

- Full unit/integration suite: 723 passed before the final competing-head regression was added; the affected persistence suite then passed all 20 tests, including the added regression.
- TypeScript check passed.
- Frozen-release scenario and native/legacy save compatibility checks passed.
- Native browser smoke: 35 passed with metadata-only saving and 35 passed with legacy full-chat metadata saving. Coverage includes old pending recovery after reload, no duplicate report generation, mobile touch drag and click separation, viewport clamping, delayed-save navigation, single setting write, battle settlement, chat switching, import/clear/rollback, and disposal.
- This is synthetic-host validation. The user's actual device, runtime version, pending journal, and underlying error were unavailable; the screenshot alone does not establish one unique root cause. The new error detail and visible version make remaining device-specific failures diagnosable.
