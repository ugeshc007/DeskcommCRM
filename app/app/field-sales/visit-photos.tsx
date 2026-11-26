'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function VisitPhotos({ visitId }: { visitId: string }) {
  const [open, setOpen] = useState(false), [ids, setIds] = useState<string[]>([]);
  const [image, setImage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(`/api/v1/field-sales/photos?visit_id=${visitId}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error('Unable to load photos. Close and reopen to retry.'); return body.data; })
      .then(data => setIds(data.photos.map((photo: { id: string }) => photo.id)))
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load photos. Close and reopen to retry.'); });
    return () => controller.abort();
  }, [open, visitId]);
  async function view(id: string) {
    setBusy(true); setError(''); setImage(''); setSelected(''); setConfirmDelete(false);
    try {
      const response = await fetch(`/api/v1/field-sales/photos?id=${id}`, { cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error();
      setImage(`data:image/jpeg;base64,${body.data.image_base64}`);
      setSelected(id);
    } catch { setError('Photo unavailable. Your access may have changed. Retry or contact your administrator.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/field-sales/photos?id=${selected}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      setIds(current => current.filter(id => id !== selected)); setImage(''); setSelected(''); setConfirmDelete(false);
    } catch { setError('Photo could not be removed. Refresh your access and retry.'); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { setOpen(value); setImage(''); setIds([]); setError(''); setSelected(''); setConfirmDelete(false); }}>
    <DialogTrigger asChild><Button className="mt-3" variant="outline">View visit photos</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Visit photos</DialogTitle>
      <DialogDescription>Private employee uploads. Viewing a photo is recorded in the access audit.</DialogDescription></DialogHeader>
      {error && <p role="alert">{error}</p>}
      {!ids.length && !error && <p>No uploaded photos found. Pending phone uploads appear after sync.</p>}
      <div className="flex flex-wrap gap-2">{ids.map((id, index) => <Button key={id} disabled={busy} variant="outline" onClick={() => void view(id)}>Photo {index + 1}</Button>)}</div>
      {busy && <p role="status">Loading photo…</p>}
      {/* Authenticated bytes stay in component memory, never a public asset or optimization cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image && <img src={image} alt="Selected visit attachment" className="max-h-[60vh] w-full rounded-lg object-contain" />}
      {selected && !confirmDelete && <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>Remove selected photo</Button>}
      {confirmDelete && <div className="space-y-2 rounded-lg border p-3"><p>Delete this photo permanently? This cannot be undone.</p><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep photo</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>Confirm photo deletion</Button></div></div>}
    </DialogContent>
  </Dialog>;
}
