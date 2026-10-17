import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {admitReport, type ReportView} from './backtest-report';
import approval from '../../data/research/stock_report_approvals.json';

/** Fixed server-side paths, no user URL, upload, broker or database access. */
export async function loadBacktestReport(): Promise<ReportView> {
  try {
    const [raw,protocol]=await Promise.all([
      readFile(join(process.cwd(),'research/stock_reports/approved-report.json'),'utf8'),
      readFile(join(process.cwd(),'research/stock_audit_20261012/protocol.json')),
    ]);
    return admitReport(JSON.parse(raw),createHash('sha256').update(raw).digest('hex'),
      approval.approvedSha256,createHash('sha256').update(protocol).digest('hex'));
  } catch {
    return {status:'not_measured',reason:'No readable, validated historical report is available.',report:null};
  }
}
