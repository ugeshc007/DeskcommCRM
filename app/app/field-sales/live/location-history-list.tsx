'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { nearbyPlaceFromTiles } from '@/lib/field-sales/nearby-place-tiles';
import { googleMapsPointUrl } from '@/lib/field-sales/map-links';
import type { Operations } from '../operations';

type Point = Operations['points'][number];
const pageSize = 10;
const pointKey = (point: Point) => `${point.captured_at}:${point.latitude}:${point.longitude}`;

export function LocationHistoryList({ points, tilePath, timezone }: { points: Point[]; tilePath: string | null; timezone: string }) {
  const [page, setPage] = useState(0);
  const [labels, setLabels] = useState<Record<string, string | null>>({});
  const lookedUp = useRef(new Set<string>());
  const newestFirst = useMemo(() => [...points].reverse(), [points]);
  const pageCount = Math.max(1, Math.ceil(points.length / pageSize));
  const visible = useMemo(() => newestFirst.slice(page * pageSize, (page + 1) * pageSize), [newestFirst, page]);

  useEffect(() => {
    if (!tilePath) return;
    let cancelled = false;
    const lookedUpNow = lookedUp.current;
    const pending = visible.filter(point => !lookedUpNow.has(pointKey(point)));
    for (const point of pending) lookedUpNow.add(pointKey(point));
    // A page is small so place lookup never downloads an entire day's route at once.
    void Promise.all(pending.map(async point => {
      const key = pointKey(point);
      const label = await nearbyPlaceFromTiles(tilePath, window.location.origin, point.latitude, point.longitude);
      if (!cancelled) setLabels(current => ({ ...current, [key]: label }));
    }));
    return () => { cancelled = true; for (const point of pending) lookedUpNow.delete(pointKey(point)); };
  }, [tilePath, visible]);

  const clock = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone });
  return <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Location history">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">Location history</h2>
        <p className="text-xs text-muted-foreground">{points.length} retained GPS fixes · newest first. Place names are nearby map labels, not verified street addresses.</p></div>
      <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
    </div>
    {points.length === 0 ? <p className="text-sm">No recorded locations for this date.</p> : <>
      <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
        <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Recorded ({timezone})</th><th className="py-2 pr-3 font-medium">Nearby area</th><th className="py-2 pr-3 font-medium">Coordinates</th><th className="py-2 pr-3 font-medium">GPS accuracy</th><th className="py-2 font-medium">Map</th></tr></thead>
        <tbody>{visible.map((point, index) => {
          const key = pointKey(point);
          const label = labels[key];
          const flags = point.quality_flags ?? [];
          const url = googleMapsPointUrl(point.latitude, point.longitude);
          return <tr key={`${key}:${index}`} className="border-b last:border-0">
            <td className="py-2 pr-3 whitespace-nowrap">{clock.format(new Date(point.captured_at))}</td>
            <td className="py-2 pr-3">{tilePath ? label === undefined ? 'Finding nearby area…' : label ?? 'No nearby mapped area' : 'Area labels not configured'}
              {(point.mock_location || flags.length > 0) && <span className="block text-xs text-amber-700">{point.mock_location ? 'Mock location' : `Flagged GPS: ${flags.join(', ')}`}</span>}</td>
            <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{point.latitude}, {point.longitude}</td>
            <td className="py-2 pr-3 whitespace-nowrap">±{Math.round(point.accuracy_m)} m</td>
            <td className="py-2"><a className="underline underline-offset-2" href={url} target="_blank" rel="noreferrer" aria-label={`Open location from ${clock.format(new Date(point.captured_at))} in Google Maps`}>Open</a></td>
          </tr>;
        })}</tbody>
      </table></div>
      <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
        <Button type="button" size="sm" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Older</Button></div>
    </>}
  </section>;
}
