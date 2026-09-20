import { describe, expect, it } from 'vitest';
import { csvCell, dailyFieldReport } from './reports';
describe('field daily report', () => {
  it('neutralizes spreadsheet formulas and quotes embedded delimiters', () => {
    expect(csvCell(' =SUM(1,2)')).toBe('"\' =SUM(1,2)"');
    expect(csvCell('A "quoted" name')).toBe('"A ""quoted"" name"');
    expect(csvCell('\ttext')).toBe('"\'\ttext"');
  });
  it('clips midnight-spanning sessions to the organization day and keeps corrections separate', () => {
    const result = dailyFieldReport('2026-09-19', 'Asia/Dubai', [{ display_name: 'Example',
      punched_in_at: '2026-09-18T19:00:00Z', punched_out_at: '2026-09-18T22:00:00Z',
      corrected_in: '2026-09-18T20:30:00Z', corrected_out: '2026-09-18T22:00:00Z' }], []);
    expect(result).toContain('"120","90"');
  });
  it('does not count earlier overdue visits as visits on the selected day or export private fields', () => {
    const visit = { display_name: 'Example', project_name: 'Site', local_date: '2026-09-18', status: 'completed', notes: 'private note', latitude: 25 };
    const result = dailyFieldReport('2026-09-19', 'Asia/Dubai', [], [visit]);
    expect(result).not.toContain('Example'); expect(result).not.toContain('private note');
  });
});
