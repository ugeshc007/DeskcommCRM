import { describe, expect, it } from 'vitest';
import { displayRoute, type RecordedPoint } from './route-quality';

const point = (latitude: number, seconds: number, accuracy_m = 12, session_id = 'session'): RecordedPoint => ({
  session_id, latitude, longitude: 55, captured_at: new Date(Date.UTC(2026, 8, 22, 8, 0, seconds)).toISOString(),
  accuracy_m, mock_location: false,
});

describe('displayRoute', () => {
  it('preserves a plausible path and never changes raw points', () => {
    const raw = [point(25, 0), point(25.0002, 30), point(25.0004, 50)];
    expect(displayRoute(raw)).toMatchObject({ omitted: 0, lines: [[[55, 25], [55, 25.0002], [55, 25.0004]]] });
    expect(raw).toHaveLength(3);
  });
  it('does not draw through poor accuracy, mock fixes or another session', () => {
    const mock = { ...point(25.0002, 20), mock_location: true };
    const raw = [point(25, 0), point(25.0001, 10, 150), mock, point(25.0003, 30), point(25.0004, 40, 12, 'other')];
    expect(displayRoute(raw)).toMatchObject({ omitted: 2, lines: [] });
  });
  it('drops a brief out-and-back GPS bounce but not the rest of the route', () => {
    const raw = [point(25, 0), point(25.01, 20), point(25.00001, 40), point(25.0002, 55)];
    expect(displayRoute(raw)).toMatchObject({ omitted: 1, lines: [[[55, 25], [55, 25.00001], [55, 25.0002]]] });
  });
  it('removes an impossible out-and-back jump without fabricating a road route', () => {
    const raw = [point(25, 0), point(25.0001, 10), point(26, 20), point(25.0002, 30), point(25.0003, 40)];
    expect(displayRoute(raw)).toMatchObject({ omitted: 1, lines: [[[55, 25], [55, 25.0001], [55, 25.0002], [55, 25.0003]]] });
  });
  it('separates distinct sessions', () => {
    const raw = [point(25, 0), point(25.0001, 10), point(25.0002, 20, 12, 'other'), point(25.0003, 30, 12, 'other')];
    expect(displayRoute(raw)).toMatchObject({ omitted: 0, lines: [[[55, 25], [55, 25.0001]], [[55, 25.0002], [55, 25.0003]]] });
  });
});
