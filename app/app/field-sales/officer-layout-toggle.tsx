'use client';

import { Button } from '@/components/ui/button';

export type OfficerLayout = 'list' | 'grid';

export function OfficerLayoutToggle({ layout, onChange, label }: {
  layout: OfficerLayout; onChange: (layout: OfficerLayout) => void; label: string;
}) {
  return <div role="group" aria-label={label} className="inline-flex rounded-md border bg-background p-1">
    <Button type="button" size="sm" variant={layout === 'list' ? 'secondary' : 'ghost'} aria-pressed={layout === 'list'} onClick={() => onChange('list')}>List</Button>
    <Button type="button" size="sm" variant={layout === 'grid' ? 'secondary' : 'ghost'} aria-pressed={layout === 'grid'} onClick={() => onChange('grid')}>Grid</Button>
  </div>;
}
