import { routeColor, routeDash } from '@/lib/field-sales/route-colors';

export function RouteSwatch({ styleIndex }: { styleIndex: number }) {
  const dash = routeDash(styleIndex)?.map(part => part * 4).join(' ');
  return <svg aria-hidden="true" className="h-3 w-8 shrink-0" viewBox="0 0 32 12">
    <line x1="1" y1="6" x2="31" y2="6" stroke={routeColor(styleIndex)} strokeWidth="4"
      strokeLinecap="round" strokeDasharray={dash}/>
  </svg>;
}
