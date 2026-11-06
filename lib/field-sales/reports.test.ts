import { describe, expect, it } from 'vitest';
import { csvCell, dailyFieldReport, locationHistoryReport } from './reports';
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
describe('field location history report', () => {
  it('exports retained raw fixes with Dubai and UTC times, accuracy and map links', () => {
    const result = locationHistoryReport('2026-11-07', 'Asia/Dubai', '=Test employee', [
      { captured_at: '2026-11-07T08:30:00.000Z', latitude: 25.2048, longitude: 55.2708,
        accuracy_m: 12, mock_location: false, quality_flags: [] },
      { captured_at: '2026-11-07T08:31:00.000Z', latitude: 25.205, longitude: 55.271,
        accuracy_m: 230, mock_location: true, quality_flags: ['poor_accuracy', 'mock'] },
    ]);
    expect(result).toContain('"\'=Test employee"');
    expect(result).toContain('"07/11/2026, 12:30:00","Asia/Dubai","2026-11-07T08:30:00.000Z"');
    expect(result).toContain('"230","Yes","poor_accuracy; mock"');
    expect(result).toContain('https://www.openstreetmap.org/?mlat=25.2048&mlon=55.2708#map=17/25.2048/55.2708');
    expect(result.split('\r\n')).toHaveLength(4);
  });
});
