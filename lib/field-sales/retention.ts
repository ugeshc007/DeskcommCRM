/** Daily scheduler consumer. The database owns each organization's retention cutoff. */
export async function sweepFieldLocations(runBatch: (limit: number) => Promise<number>) {
  let deleted = 0;
  for (let batch = 0; batch < 100; batch++) {
    const count = await runBatch(1000);
    if (!Number.isInteger(count) || count < 0 || count > 1000) throw new Error('field_retention_invalid_result');
    deleted += count;
    if (count < 1000) return { deleted, has_more: false };
  }
  return { deleted, has_more: true };
}
