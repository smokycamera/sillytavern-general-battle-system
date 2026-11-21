import type { BattleReport } from './battle-reports.js';
import type { BattleStart } from './report-history.js';
import { packArchiveJson, readArchiveJson } from './storage-codec.js';

/** Archived openings are retained verbatim, without paying their JSON size on every write. */
export function packReportStart(report: BattleReport): BattleReport {
  if (!report.start || report.start.version !== 1) return report;
  const packedStart = packArchiveJson(report.start);
  if (!packedStart) return report;
  const { start: _start, ...rest } = report;
  return { ...rest, packedStart };
}

export function readReportStart(report: BattleReport): BattleStart | undefined {
  if (report.start) return report.start;
  if (!report.packedStart) return undefined;
  const opening = readArchiveJson(report.packedStart) as BattleStart;
  if (opening?.version !== 1 || opening.battleId !== report.id || !opening.snapshot || !opening.before
    || (opening.kind !== 'small' && opening.kind !== 'mass')) throw Error('压缩战报开局记录损坏');
  return opening;
}

export function expandReportStart(report: BattleReport): BattleReport {
  if (!report.packedStart) return report;
  const { packedStart: _packed, ...rest } = report;
  return { ...rest, start: readReportStart(report) };
}
