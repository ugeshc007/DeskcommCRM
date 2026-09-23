import { describe, expect, it } from 'vitest';
import { accuracyRing, displayRoute, livePosition, reliablePosition, type RecordedPoint } from './route-quality';

const point = (latitude: number, seconds: number, accuracy_m = 12, session_id = 'session'): RecordedPoint => ({
  session_id, latitude, longitude: 55, captured_at: new Date(Date.UTC(2026, 8, 22, 8, 0, seconds)).toISOString(),
  accuracy_m, mock_location: false,
});

describe('displayRoute', () => {
  it('draws sustained, precise movement and never changes raw points', () => {
    const raw = [point(25, 0), point(25.0004, 20), point(25.00041, 40), point(25.0008, 60), point(25.00081, 80)];
    expect(displayRoute(raw)).toMatchObject({ omitted: 2, lines: [[[55, 25], [55, 25.00041], [55, 25.00081]]] });
    expect(raw).toHaveLength(5);
  });
  it('does not draw through poor accuracy, mock fixes or another session', () => {
    const mock = { ...point(25.0002, 20), mock_location: true };
    const raw = [point(25, 0), point(25.0001, 10, 150), mock, point(25.0003, 30), point(25.0004, 40, 12, 'other')];
    expect(displayRoute(raw)).toMatchObject({ omitted: 2, lines: [] });
  });
  it('does not turn an indoor GPS cloud into a route', () => {
    const raw = Array.from({ length: 30 }, (_, index) => point(25 + Math.sin(index) * 0.0002, index * 20, 25));
    expect(displayRoute(raw)).toMatchObject({ omitted: 29, lines: [], plotted: [raw[0]] });
    expect(raw).toHaveLength(30);
  });
  it('retains indoor 70 m fixes only in raw history, not as route dots', () => {
    const raw = [point(25, 0, 70), point(25.001, 20, 70), point(25.00101, 40, 70)];
    expect(displayRoute(raw)).toMatchObject({ omitted: 3, lines: [], plotted: [] });
  });
  it('drops a brief out-and-back GPS bounce', () => {
    const raw = [point(25, 0), point(25.01, 20), point(25.00001, 40), point(25.0002, 55)];
    expect(displayRoute(raw)).toMatchObject({ omitted: 3, lines: [], plotted: [raw[0]] });
  });
  it('removes an impossible jump without fabricating a road route', () => {
    const raw = [point(25, 0), point(25.0001, 10), point(26, 20), point(25.0002, 30), point(25.0003, 40)];
    expect(displayRoute(raw)).toMatchObject({ omitted: 4, lines: [], plotted: [raw[0]] });
  });
  it('separates distinct sessions', () => {
    const raw = [point(25, 0), point(25.0004, 10), point(25.00041, 20),
      point(25.01, 30, 12, 'other'), point(25.0104, 40, 12, 'other'), point(25.01041, 50, 12, 'other')];
    expect(displayRoute(raw).lines).toEqual([[[55, 25], [55, 25.00041]], [[55, 25.01], [55, 25.01041]]]);
  });
  it('rejects imprecise and mock current pins and measures uncertainty in metres', () => {
    expect(reliablePosition(point(25, 0, 101))).toBe(false);
    expect(reliablePosition({ ...point(25, 0), mock_location: true })).toBe(false);
    expect(reliablePosition(point(25, 0, 30))).toBe(true);
    const ring = accuracyRing(55, 25, 30);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    expect((ring[8]![1]! - 25) * 111_320).toBeCloseTo(30, 5);
  });
  it('shows a live pin only for a recent reliable fix in an open, connected shift', () => {
    const fix = { status: 'working', online: true, latitude: 25, longitude: 55, accuracy_m: 19,
      mock_location: false, captured_at: '2026-09-22T18:00:00Z' };
    const now = '2026-09-22T18:02:00Z';
    expect(livePosition(fix, now)).toBe(true);
    expect(livePosition({ ...fix, online: false }, now)).toBe(false);
    expect(livePosition({ ...fix, status: null }, now)).toBe(false);
    expect(livePosition({ ...fix, accuracy_m: 146 }, now)).toBe(false);
    expect(livePosition({ ...fix, captured_at: '2026-09-22T17:56:59Z' }, now)).toBe(false);
    expect(livePosition({ ...fix, captured_at: '2026-09-22T17:57:00Z' }, now)).toBe(true);
  });
});
