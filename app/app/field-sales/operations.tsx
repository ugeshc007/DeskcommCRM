'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Map as LibreMap, GeoJSONSource, Marker, Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { localParts, wallTimeToUtc } from '@/lib/field-sales/schedule';
import { VisitPhotos } from './visit-photos';
import { fieldMapStyle } from '@/lib/field-sales/map-style';
import { accuracyRing, displayRoute, reliablePosition } from '@/lib/field-sales/route-quality';
import { OfficerCards } from './officer-cards';

type Position = { employee_id: string; display_name: string; status: string | null; latitude: number | null; longitude: number | null; captured_at: string | null; accuracy_m: number | null; mock_location: boolean | null; last_reported_at: string | null; last_reported_accuracy_m: number | null; online: boolean; last_seen_at: string | null };
type Point = { session_id: string; latitude: number; longitude: number; captured_at: string; accuracy_m: number; mock_location: boolean };
type Session = { id: string; employee_id: string; display_name: string; project_name: string | null; site_name: string | null; status: string; punched_in_at: string; punched_out_at: string | null; corrected_in: string | null; corrected_out: string | null };
type Correction = { id: string; employee_id: string; display_name: string; proposed_in: string; proposed_out: string; reason: string; status: string; review_note: string };
type Visit = { id: string; revision: number; display_name: string; project_name: string; status: string; notes: string; next_action: string; next_action_at: string | null; next_action_completed_at: string | null };
// Geographic view, not a border polygon: the installed UAE archive also contains nearby tiles.
const UAE_MAP_BOUNDS: [[number, number], [number, number]] = [[51.4, 22.5], [56.5, 26.2]];
export type ShopCollection = { id: string; employee_id: string; project_id: string; project_customer_id: string; session_id: string;
  captured_at: string; amount_cents: string | null; balance_after_cents: string | null; currency: string;
  voided_at: string | null; void_reason: string | null; shop_name: string; customer_code: string | null; project_name: string; latitude: number | null; longitude: number | null; accuracy_m: number | null };
export type FieldActivity = { id: string; employee_id: string; session_id: string; project_id: string; project_customer_id: string | null;
  note: string; source: 'voice' | 'typed'; captured_at: string; project_name: string; shop_name: string | null };
export type Operations = { role: string; generated_at: string; region: { country_code: string; timezone: string }; latest: Position[]; sessions: Session[]; visits: Visit[]; collections: ShopCollection[]; activities: FieldActivity[]; corrections: Correction[]; points: Point[]; map: { map_tile_path: string | null; map_attribution: string } | null };

export function RouteMap({ data, selectedEmployeeId, onSelectEmployee, routeDate }: { data: Operations; selectedEmployeeId: string; onSelectEmployee: (employeeId: string) => void; routeDate: string }) {
  const container = useRef<HTMLDivElement>(null), map = useRef<LibreMap | null>(null), markers = useRef<Marker[]>([]);
  const latest = useRef(data), selectEmployee = useRef(onSelectEmployee), selection = useRef(selectedEmployeeId), day = useRef(routeDate), fittedSelection = useRef('');
  const [problem, setProblem] = useState(''), [mapReady, setMapReady] = useState(false);
  useEffect(() => { latest.current = data; selectEmployee.current = onSelectEmployee; selection.current = selectedEmployeeId; day.current = routeDate; }, [data, onSelectEmployee, selectedEmployeeId, routeDate]);
  useEffect(() => {
    let closed = false;
    let resizeObserver: ResizeObserver | null = null;
    void Promise.all([import('maplibre-gl'), import('pmtiles')]).then(async ([lib, archive]) => {
      if (closed || !container.current) return;
      setMapReady(false); setProblem('');
      lib.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      const tile = data.map?.map_tile_path;
      const header = tile?.endsWith('.pmtiles') ? await new archive.PMTiles(new URL(tile, window.location.origin).toString()).getHeader() : null;
      if (closed || !container.current) return;
      const uae = data.region.country_code === 'AE';
      const archiveBounds: [[number, number], [number, number]] | null = header
        ? [[header.minLon, header.minLat], [header.maxLon, header.maxLat]] : null;
      const instance = new lib.Map({ container: container.current, center: uae ? [55.27, 25.2] : [0, 0], zoom: uae ? 11 : 1,
        attributionControl: false, renderWorldCopies: false,
        ...(uae ? { maxBounds: UAE_MAP_BOUNDS, minZoom: 8 }
          : archiveBounds ? { bounds: archiveBounds, fitBoundsOptions: { padding: 20 } } : {}),
        style: fieldMapStyle(tile, window.location.origin, header) });
      instance.on('idle', () => {
        if (!closed && tile && instance.isSourceLoaded('basemap')) setMapReady(!header || instance.querySourceFeatures('basemap', { sourceLayer: 'roads' }).length > 0);
      });
      map.current = instance;
      resizeObserver = new ResizeObserver(() => instance.resize());
      resizeObserver.observe(container.current);
      instance.addControl(new lib.NavigationControl(), 'top-right');
      let markerSignature = '';
      let activePopup: Popup | null = null;
      const draw = () => {
        if (!instance.isStyleLoaded()) return;
        const current = latest.current;
        const nextMarkerSignature = JSON.stringify([selection.current, current.latest.map(p => [p.employee_id, p.display_name, p.latitude, p.longitude, p.accuracy_m, p.mock_location, p.captured_at, p.last_reported_at]),
          current.collections.filter(c => c.employee_id === selection.current).map(c => [c.id,c.latitude,c.longitude])]);
        if (markerSignature !== nextMarkerSignature) {
          activePopup?.remove(); activePopup = null;
          markers.current.forEach(marker => marker.remove()); markers.current = [];
          for (const position of current.latest) {
            if (position.latitude === null || position.longitude === null || position.accuracy_m === null
              || !reliablePosition({ ...position, latitude: position.latitude, longitude: position.longitude, accuracy_m: position.accuracy_m, mock_location: Boolean(position.mock_location) })) continue;
            const newerImpreciseFix = !!position.last_reported_at && !!position.captured_at
              && Date.parse(position.last_reported_at) > Date.parse(position.captured_at);
            const marker = new lib.Marker({ color: position.employee_id === selection.current ? '#2563eb' : newerImpreciseFix ? '#d97706' : '#166534' })
              .setLngLat([position.longitude, position.latitude]).addTo(instance);
            const captured = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: current.region.timezone }).format(new Date(position.captured_at!));
            const popup = new lib.Popup({ closeButton: false, closeOnClick: false, offset: 24 })
              .setText(`${position.display_name} · last reliable fix ${captured} · approximate ±${Math.round(position.accuracy_m)} m${newerImpreciseFix ? ' · newer GPS too imprecise or untrusted' : ''}`);
            const element = marker.getElement(); element.tabIndex = 0; element.setAttribute('role', 'button');
            element.setAttribute('aria-label', `View ${position.display_name}'s route for this date`);
            element.title = position.display_name;
            const showName = () => { activePopup?.remove(); popup.setLngLat(marker.getLngLat()).addTo(instance); activePopup = popup; };
            const hideName = () => { if (activePopup === popup) { popup.remove(); activePopup = null; } };
            element.addEventListener('mouseenter', showName);
            element.addEventListener('mouseleave', hideName);
            element.addEventListener('focus', showName);
            element.addEventListener('blur', hideName);
            element.addEventListener('click', () => { popup.remove(); selectEmployee.current(position.employee_id); });
            element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); popup.remove(); selectEmployee.current(position.employee_id); } });
            markers.current.push(marker);
          }
          for (const shop of current.collections.filter(c => c.employee_id === selection.current && !c.voided_at && c.latitude !== null && c.longitude !== null)) {
            const icon = document.createElement('button'); icon.type = 'button'; icon.textContent = '🏬';
            icon.className = 'flex size-9 items-center justify-center rounded-full border-2 border-white bg-amber-400 shadow-md';
            icon.title = shop.shop_name; icon.setAttribute('aria-label', `Shop visit: ${shop.shop_name}`);
            const marker = new lib.Marker({ element: icon, anchor: 'bottom' }).setLngLat([shop.longitude!, shop.latitude!]).addTo(instance);
            const popup = new lib.Popup({ closeButton: false, closeOnClick: false, offset: 20 })
              .setText(`${shop.shop_name} · ${shop.project_name}`);
            icon.addEventListener('mouseenter', () => { activePopup?.remove(); popup.setLngLat(marker.getLngLat()).addTo(instance); activePopup = popup; });
            icon.addEventListener('mouseleave', () => { if (activePopup === popup) { popup.remove(); activePopup = null; } });
            icon.addEventListener('focus', () => { activePopup?.remove(); popup.setLngLat(marker.getLngLat()).addTo(instance); activePopup = popup; });
            icon.addEventListener('blur', () => { if (activePopup === popup) { popup.remove(); activePopup = null; } });
            markers.current.push(marker);
          }
          markerSignature = nextMarkerSignature;
        }
        const { lines, plotted } = displayRoute(current.points);
        const selected = current.latest.find(position => position.employee_id === selection.current);
        const showAccuracy = selected && selected.latitude !== null && selected.longitude !== null && selected.accuracy_m !== null
          && reliablePosition({ latitude: selected.latitude, longitude: selected.longitude,
            accuracy_m: selected.accuracy_m, mock_location: Boolean(selected.mock_location) });
        const accuracyArea = { type: 'FeatureCollection' as const, features: showAccuracy ? [{ type: 'Feature' as const,
          properties: {}, geometry: { type: 'Polygon' as const,
            coordinates: [accuracyRing(selected.longitude!, selected.latitude!, Math.max(10, selected.accuracy_m!))] } }] : [] };
        const accuracySource = instance.getSource('position-accuracy') as GeoJSONSource | undefined;
        if (accuracySource) accuracySource.setData(accuracyArea);
        else { instance.addSource('position-accuracy', { type: 'geojson', data: accuracyArea });
          instance.addLayer({ id: 'position-accuracy-area', type: 'fill', source: 'position-accuracy',
            paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.12 } });
          instance.addLayer({ id: 'position-accuracy-edge', type: 'line', source: 'position-accuracy',
            paint: { 'line-color': '#2563eb', 'line-opacity': 0.65, 'line-width': 1 } }); }
        const route = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, properties: {}, geometry: { type: 'MultiLineString' as const, coordinates: lines } }] };
        const source = instance.getSource('route') as GeoJSONSource | undefined;
        if (source) source.setData(route);
        else { instance.addSource('route', { type: 'geojson', data: route }); instance.addLayer({ id: 'recorded-route', type: 'line', source: 'route', paint: { 'line-color': '#2563eb', 'line-width': 4 } }); }
        // Isolated fixes remain visible without inventing a path across missing GPS.
        const samples = { type: 'FeatureCollection' as const, features: plotted.map(point => ({ type: 'Feature' as const,
          properties: {}, geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] } })) };
        const sampleSource = instance.getSource('route-samples') as GeoJSONSource | undefined;
        if (sampleSource) sampleSource.setData(samples);
        else { instance.addSource('route-samples', { type: 'geojson', data: samples }); instance.addLayer({ id: 'recorded-route-samples', type: 'circle', source: 'route-samples',
          paint: { 'circle-radius': 4, 'circle-color': '#2563eb', 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff' } }); }
        const selectionKey = `${selection.current}:${day.current}`;
        if (selection.current && fittedSelection.current !== selectionKey && plotted.length) {
          const bounds = new lib.LngLatBounds(); plotted.forEach(point => bounds.extend([point.longitude, point.latitude]));
          instance.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 250 }); fittedSelection.current = selectionKey;
        }
      };
      instance.on('load', () => {
        instance.resize();
        draw();
        const plotted = displayRoute(latest.current.points).plotted;
        const points = plotted.length ? plotted : latest.current.latest.filter(p => p.latitude !== null && p.longitude !== null
          && p.accuracy_m !== null && reliablePosition({ latitude: p.latitude, longitude: p.longitude,
            accuracy_m: p.accuracy_m, mock_location: Boolean(p.mock_location) }));
        if (points.length) {
          const bounds = new lib.LngLatBounds(); points.forEach(p => bounds.extend([p.longitude!, p.latitude!]));
          instance.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
        }
      });
      instance.on('error', () => setProblem('Map tiles or rendering are unavailable. Recorded positions remain available below.'));
      // Data updates do not reset the manager's chosen zoom or pan.
      const timer = window.setInterval(draw, 2000);
      instance.once('remove', () => window.clearInterval(timer));
    }).catch(() => setProblem('Map rendering could not be loaded. Use the position list below.'));
    return () => { closed = true; resizeObserver?.disconnect(); markers.current.forEach(marker => marker.remove()); markers.current = []; map.current?.remove(); map.current = null; };
  }, [data.map?.map_tile_path, data.region.country_code]);
  return <section className="space-y-2">
    {!data.map?.map_tile_path && <p className="rounded-lg border p-3 text-sm">Basemap not configured. This view plots recorded coordinates only; it does not show roads. No external map tiles are requested.</p>}
    {problem && <p role="alert">{problem}</p>}
    {data.map?.map_tile_path && !mapReady && !problem && <p role="status">Loading self-hosted map…</p>}
    <div ref={container} data-map-ready={mapReady} className="h-[420px] overflow-hidden rounded-xl border" aria-label="Recorded employee positions and selected work route"/>
    {data.map?.map_tile_path && <p className="text-xs text-muted-foreground">{data.map.map_attribution} · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>}
    <p className="text-xs text-muted-foreground">Pins show the last reliable fix from an open work session; orange means a newer GPS report was too imprecise or untrusted. Check the pin timestamp before treating it as current. Blue lines require precise, confirmed movement. The shaded circle shows reported uncertainty; indoors, GPS cannot identify an exact building. Raw records remain unchanged.</p>
  </section>;
}

export function FieldOperations({ organizationId, userId, date, onOpenRoute }: { organizationId: string; userId: string; date: string; onOpenRoute: (employeeId: string) => void }) {
  const [sessionId, setSessionId] = useState(''), [employeeId, setEmployeeId] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<Session | null>(null), [review, setReview] = useState<Correction | null>(null);
  const [complete, setComplete] = useState<Visit | null>(null);
  const query = useQuery({ queryKey: ['field-operations', organizationId, userId, date, sessionId, employeeId], gcTime: 0,
    refetchInterval: 15000, queryFn: async (): Promise<Operations> => {
      const selection = sessionId ? `&session_id=${sessionId}` : employeeId ? `&employee_id=${employeeId}` : '';
      const response = await fetch(`/api/v1/field-sales/operations?date=${date}${selection}`, { cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? 'Unable to load field activity.'); return body.data;
    } });
  const data = query.data;
  const time = (value: string | null) => value && data ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: data.region.timezone }).format(new Date(value)) : '—';
  async function exportReport() {
    if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/field-sales/operations?date=${date}&report=daily`, { cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? 'Unable to export report.');
      const url = URL.createObjectURL(new Blob([body.data.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = body.data.filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to export report.'); }
    finally { setBusy(false); }
  }
  async function submit(command: unknown, endpoint = '/api/v1/field-sales/operations') {
    if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? 'Unable to save.');
      setRequest(null); setReview(null); setComplete(null); await query.refetch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Live team view · {date}</h2><p className="text-sm text-muted-foreground">Positions refresh every 15 seconds. Select a salesperson on the map to open their complete recorded route for this date.</p></div><Button variant="outline" onClick={() => void query.refetch()}>Refresh</Button></div>
    {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
    {query.isPending && <p role="status">Loading authorized field activity…</p>}
    {data && <>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><h2 className="font-semibold">Daily attendance and visit report</h2><p className="text-sm text-muted-foreground">Includes breaks; not a payroll calculation. GPS coordinates and visit notes are excluded.</p></div><Button variant="outline" disabled={busy} onClick={() => void exportReport()}>Export daily CSV</Button></section>
      {employeeId && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4"><p><strong>{data.latest.find(person => person.employee_id === employeeId)?.display_name ?? 'Selected salesperson'}</strong> · complete recorded route for {date}</p><Button variant="outline" onClick={() => setEmployeeId('')}>Show all live positions</Button></div>}
      <OfficerCards people={data.latest} timezone={data.region.timezone} date={date} selectedEmployeeId={employeeId} onSelect={onOpenRoute}/>
      <RouteMap data={data} selectedEmployeeId={employeeId} routeDate={date} onSelectEmployee={onOpenRoute}/>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Attendance and route history</h2>
        <p className="text-sm text-muted-foreground">Session spans include breaks. Approved corrections are shown separately and never rewrite raw GPS or original punch records.</p>
        {(sessionId || employeeId) && <Button variant="outline" onClick={() => { setSessionId(''); setEmployeeId(''); }}>Return to current positions</Button>}
        {!data.sessions.length && <p>No sessions for this date.</p>}
        {data.sessions.map(session => <article key={session.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"><div><h3 className="font-semibold">{session.display_name}</h3><p className="text-sm text-muted-foreground">{session.project_name ? `${session.project_name}${session.site_name ? ` · ${session.site_name}` : ''}` : 'Legacy session without a selected project'}</p><p>{time(session.punched_in_at)} → {session.punched_out_at ? time(session.punched_out_at) : 'Still on duty'}</p>{session.corrected_in && <p className="text-sm">Approved correction: {time(session.corrected_in)} → {time(session.corrected_out)}</p>}</div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setEmployeeId(''); setSessionId(session.id); }}>View this session</Button>{session.employee_id === userId && session.punched_out_at && <Button variant="outline" onClick={() => setRequest(session)}>Request correction</Button>}</div></article>)}
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Visits and next actions</h2><p className="text-sm text-muted-foreground">Open overdue actions from earlier dates remain here until completed. These are in-app reminders, not automatic messages to customers.</p>{!data.visits.length && <p>No recorded visits for this date.</p>}{data.visits.map(visit => <article key={visit.id} className="rounded-xl border p-4"><h3 className="font-semibold">{visit.project_name} · {visit.display_name}</h3><p>{visit.status}</p><p className="whitespace-pre-wrap text-sm">{visit.notes}</p><VisitPhotos visitId={visit.id}/>{visit.next_action && <div className="mt-2 space-y-2 text-sm"><p>Next: {visit.next_action} · {time(visit.next_action_at)}</p>{visit.next_action_completed_at ? <p>Completed: {time(visit.next_action_completed_at)}</p> : <><p>{visit.next_action_at && Date.parse(visit.next_action_at) <= Date.parse(data.generated_at) ? 'Due — follow up now' : 'Upcoming follow-up'}</p><Button variant="outline" disabled={busy} onClick={() => setComplete(visit)}>Mark next action complete</Button></>}</div>}</article>)}</section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Attendance correction review</h2>{!data.corrections.length && <p>No correction requests.</p>}{data.corrections.map(correction => <article key={correction.id} className="rounded-xl border p-4"><h3 className="font-semibold">{correction.display_name} · {correction.status}</h3><p>{time(correction.proposed_in)} → {time(correction.proposed_out)}</p><p className="text-sm">{correction.reason}</p>{correction.review_note && <p className="text-sm">Review: {correction.review_note}</p>}{correction.status === 'pending' && data.role !== 'agent' && correction.employee_id !== userId && <Button variant="outline" onClick={() => setReview(correction)}>Review request</Button>}</article>)}</section>
      {data.role === 'admin' && <details className="max-w-2xl rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Self-hosted basemap settings</summary><form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit({ operation: 'map_config', tile_path: String(form.get('path') ?? '') || null, attribution: String(form.get('attribution') ?? '') }, '/api/v1/field-sales'); }}>
        <p className="text-sm text-muted-foreground">Your server administrator must supply approved tiles under /field-map-tiles/. No Google key or third-party tile URL is used. Leave blank to disable roads.</p>
        <label className="grid gap-2 text-sm">Tile path<Input name="path" defaultValue={data.map?.map_tile_path ?? ''} placeholder="/field-map-tiles/uae.pmtiles"/></label>
        <label className="grid gap-2 text-sm">Tile-source attribution<Input name="attribution" maxLength={500} defaultValue={data.map?.map_attribution ?? ''}/></label><Button disabled={busy}>Save map configuration</Button>
      </form></details>}
    </>}
    <Dialog open={!!request || !!review || !!complete} onOpenChange={open => { if (!open) { setRequest(null); setReview(null); setComplete(null); } }}><DialogContent><DialogHeader><DialogTitle>{complete ? 'Complete next action?' : review ? 'Review attendance correction' : 'Request attendance correction'}</DialogTitle><DialogDescription>{complete ? 'This closes the reminder and keeps its original text and due date in the visit history.' : 'Original punch events and GPS are retained. You cannot approve your own correction.'}</DialogDescription></DialogHeader>
      {complete && <div className="space-y-3"><p>{complete.next_action}</p><Button disabled={busy} onClick={() => void submit({ operation: 'complete_next_action', command: { visit_id: complete.id, revision: complete.revision } })}>Confirm completion</Button></div>}
      {error && <p role="alert">{error}</p>}
      {request && data && <form className="space-y-3" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        try {
          const convert = (name: string) => { const value = String(form.get(name)); return wallTimeToUtc(value.slice(0, 10), value.slice(11), data.region.timezone); };
          void submit({ operation: 'correction', command: { operation: 'request', id: crypto.randomUUID(), session_id: request.id, proposed_in: convert('in'), proposed_out: convert('out'), reason: String(form.get('reason')) } });
        } catch { setError('Choose valid dates and times outside an ambiguous or skipped daylight-saving interval.'); }
      }}>
        <p className="text-sm">Both times use your organization’s time zone: {data.region.timezone}, not your device’s time zone.</p>
        <label className="grid gap-2 text-sm">Corrected punch-in<Input type="datetime-local" name="in" required defaultValue={localParts(Date.parse(request.punched_in_at), data.region.timezone)}/></label><label className="grid gap-2 text-sm">Corrected punch-out<Input type="datetime-local" name="out" required defaultValue={request.punched_out_at ? localParts(Date.parse(request.punched_out_at), data.region.timezone) : ''}/></label><label className="grid gap-2 text-sm">Reason<Textarea name="reason" required maxLength={2000}/></label><Button disabled={busy}>Submit for review</Button>
      </form>}
      {review && <form className="space-y-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit({ operation: 'correction', command: { operation: 'review', id: review.id, decision: String(form.get('decision')), note: String(form.get('note')) } }); }}>
        <label className="grid gap-2 text-sm">Decision<select name="decision" className="h-11 rounded-md border bg-background px-3"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label><label className="grid gap-2 text-sm">Review note<Textarea name="note" required maxLength={2000}/></label><Button disabled={busy}>Confirm decision</Button>
      </form>}
    </DialogContent></Dialog>
  </section>;
}
