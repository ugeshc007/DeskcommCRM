import { describe, expect, it } from 'vitest';
import { csvCell, dailyFieldReport, locationAreaChanges, locationHistoryReport } from './reports';
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
  it('exports first recorded area changes with Dubai and UTC times, accuracy and map links', () => {
    const points = [
      { captured_at: '2026-11-07T08:30:00.000Z', latitude: 25.2048, longitude: 55.2708,
        accuracy_m: 12, mock_location: false, quality_flags: [] },
      { captured_at: '2026-11-07T08:31:00.000Z', latitude: 25.205, longitude: 55.271,
        accuracy_m: 20, mock_location: false, quality_flags: [] },
      { captured_at: '2026-11-07T08:45:00.000Z', latitude: 25.23, longitude: 55.3,
        accuracy_m: 15, mock_location: false, quality_flags: [] },
      { captured_at: '2026-11-07T08:48:00.000Z', latitude: 25.231, longitude: 55.301,
        accuracy_m: 20, mock_location: false, quality_flags: [] },
    ];
    const changes = locationAreaChanges(points, ['Near Deira (area)', 'Near Deira (area)', 'Near Al Nahda (area)', 'Near Al Nahda (area)']);
    const result = locationHistoryReport('2026-11-07', 'Asia/Dubai', '=Test employee', changes);
    expect(changes).toHaveLength(2);
    expect(result).toContain('"\'=Test employee"');
    expect(result).toContain('"07/11/2026, 12:30:00","Asia/Dubai","2026-11-07T08:30:00.000Z"');
    expect(result).toContain('https://www.google.com/maps/search/?api=1&query=25.2048%2C55.2708');
    expect(result).toContain('"Nearby area (English where mapped, approximate)"');
    expect(result).toContain('"Near Deira (area)","25.2048"');
    expect(result).toContain('"Near Al Nahda (area)","25.23"');
    expect(result).not.toContain('"25.205"');
    expect(result.split('\r\n')).toHaveLength(4);
  });

  it('does not claim unknown fixes are one stationary area and records a return visit', () => {
    const times = ['10:10', '10:13', '10:16', '10:45', '11:30', '11:33', '12:00'];
    const points = times.map(time => ({ captured_at: `2026-11-07T${time}:00.000Z`,
      latitude: 25.2, longitude: 55.3, accuracy_m: 12, mock_location: false }));
    const changes = locationAreaChanges(points, ['Near Al Nahda (area)', 'Near Al Nahda (area)',
      'Near Al Nahda (area)', 'Near Al Qusais (area)', null, 'Near Al Qusais (area)', 'Near Al Nahda (area)']);
    expect(changes.map(change => change.point.captured_at)).toEqual([
      points[0]!.captured_at, points[3]!.captured_at, points[4]!.captured_at, points[6]!.captured_at,
    ]);
    expect(changes[2]!.label).toBeNull();
  });

  it('keeps city-only fixes separate because a city label cannot identify a stop', () => {
    const points = [0, 1].map(index => ({ captured_at: `2026-11-07T10:0${index}:00.000Z`,
      latitude: 25.2 + index / 100, longitude: 55.3, accuracy_m: 12, mock_location: false }));
    expect(locationAreaChanges(points, ['Near Dubai (city)', 'Near Dubai (city)'])).toHaveLength(2);
  });
});
