import { describe, expect, it, vi } from 'vitest';
import { sweepFieldLocations } from './retention';
describe('field location retention scheduler', () => {
  it('does no further work for an absent module or empty batch', async () => {
    const batch = vi.fn(async () => 0);
    expect(await sweepFieldLocations(batch)).toEqual({ deleted: 0, has_more: false });
    expect(batch).toHaveBeenCalledTimes(1);
  });
  it('drains full batches and stops after a partial batch', async () => {
    const batch = vi.fn().mockResolvedValueOnce(1000).mockResolvedValueOnce(12);
    expect(await sweepFieldLocations(batch)).toEqual({ deleted: 1012, has_more: false });
    expect(batch).toHaveBeenCalledTimes(2);
  });
  it('bounds work and reports the remaining backlog', async () => {
    const batch = vi.fn(async () => 1000);
    expect(await sweepFieldLocations(batch)).toEqual({ deleted: 100000, has_more: true });
    expect(batch).toHaveBeenCalledTimes(100);
  });
  it('does not disguise a failed or invalid batch as a successful sweep', async () => {
    await expect(sweepFieldLocations(async () => { throw new Error('unavailable'); })).rejects.toThrow('unavailable');
    await expect(sweepFieldLocations(async () => -1)).rejects.toThrow('field_retention_invalid_result');
  });
});
