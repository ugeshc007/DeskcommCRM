import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OfficerCards } from './officer-cards';
import type { Operations } from './operations';

const officer: Operations['latest'][number] = { employee_id: 'officer-a', display_name: 'Synthetic officer', status: 'working',
  latitude: null, longitude: null, captured_at: null, accuracy_m: null, mock_location: null, last_reported_at: null, last_reported_accuracy_m: null, online: true, last_seen_at: '2026-09-22T18:00:00Z' };

describe('duty cards when GPS is missing', () => {
  it('keeps a working officer visible and opens route history without requiring a map pin', async () => {
    const user = userEvent.setup(), select = vi.fn();
    render(<OfficerCards people={[officer]} timezone="Asia/Dubai" date="2026-09-22" generatedAt="2026-09-22T18:02:00Z" selectedEmployeeId="" onSelect={select}/>);
    expect(screen.getByRole('heading', { name: 'On-duty officers · 1' })).toBeVisible();
    expect(screen.getByText('On duty · working')).toBeVisible();
    expect(screen.getByText(/waiting for the phone to send a GPS position/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'View route and visits' }));
    expect(select).toHaveBeenCalledWith('officer-a');
  });

  it('counts a break as on duty and keeps off-duty history available separately', async () => {
    const user = userEvent.setup();
    render(<OfficerCards people={[{ ...officer, status: 'on_break' }, { ...officer, employee_id: 'officer-b', display_name: 'Finished officer', status: null, online: false }]}
      timezone="Asia/Dubai" date="2026-09-22" generatedAt="2026-09-22T18:02:00Z" selectedEmployeeId="" onSelect={vi.fn()}/>);
    expect(screen.getByText('On duty · on break')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'On-duty officers · 1' })).toBeVisible();
    await user.click(screen.getByText('Off-duty officers · 1'));
    const card = screen.getByRole('heading', { name: 'Finished officer' }).closest('article')!;
    expect(within(card).getByText('Off duty', { exact: true })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'View route and visits' })).toBeVisible();
  });
  it('shows a connected officer without an open session without hiding them in collapsed history', () => {
    render(<OfficerCards people={[{ ...officer, status: null }]} timezone="Asia/Dubai" date="2026-09-22" generatedAt="2026-09-22T18:02:00Z" selectedEmployeeId="" onSelect={vi.fn()}/>);
    expect(screen.getByRole('heading', { name: 'Online · no active work session' })).toBeVisible();
    expect(screen.getByRole('heading', { name: officer.display_name })).toBeVisible();
    expect(screen.getByText(/Online · App last checked in/)).toBeVisible();
    expect(screen.getByText('Off duty', { exact: true })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'On-duty officers · 0' })).toBeVisible();
  });
  it('labels a usable fix as approximate and explains newer imprecise reports', () => {
    const position = { ...officer, latitude: 25, longitude: 55, accuracy_m: 30 };
    const { rerender } = render(<OfficerCards people={[position]} timezone="Asia/Dubai" date="2026-09-22" generatedAt="2026-09-22T18:02:00Z" selectedEmployeeId="" onSelect={vi.fn()}/>);
    expect(screen.getByText('Approximate location ±30 m · not an exact building')).toBeVisible();
    rerender(<OfficerCards people={[{ ...position, captured_at: '2026-09-22T18:00:00Z', last_reported_at: '2026-09-22T18:05:00Z', last_reported_accuracy_m: 180 }]} timezone="Asia/Dubai" date="2026-09-22" generatedAt="2026-09-22T18:02:00Z" selectedEmployeeId="" onSelect={vi.fn()}/>);
    expect(screen.getByText(/Newer GPS at .* was too imprecise or untrusted; pin shows the earlier reliable fix/)).toBeVisible();
    rerender(<OfficerCards people={[{ ...officer, last_reported_at: '2026-09-22T18:05:00Z', last_reported_accuracy_m: 180 }]} timezone="Asia/Dubai" date="2026-09-22" generatedAt="2026-09-22T18:02:00Z" selectedEmployeeId="" onSelect={vi.fn()}/>);
    expect(screen.getByText(/GPS received at .* but no reliable map position · reported ±180 m/)).toBeVisible();
  });
  it('identifies an offline officer’s reliable position as historical while keeping the work session visible', () => {
    render(<OfficerCards people={[{ ...officer, online: false, latitude: 25, longitude: 55,
      accuracy_m: 19, captured_at: '2026-09-22T13:00:00Z' }]} timezone="Asia/Dubai" date="2026-09-22" generatedAt="2026-09-22T18:02:00Z" selectedEmployeeId="" onSelect={vi.fn()}/>);
    expect(screen.getByRole('heading', { name: 'On-duty officers · 1' })).toBeVisible();
    expect(screen.getByText('Punch-in recorded · App offline')).toBeVisible();
    expect(screen.queryByText('On duty · working')).not.toBeInTheDocument();
    expect(screen.getByText(/Offline · App last checked in/)).toBeVisible();
    expect(screen.getByText('Phone offline. Last known GPS is historical; there is no current live map pin.')).toBeVisible();
    expect(screen.getByText(/Last reliable position:/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'View route and visits' })).toBeVisible();
  });
  it('does not present an offline break as a live online status', () => {
    render(<OfficerCards people={[{ ...officer, status: 'on_break', online: false }]} timezone="Asia/Dubai" date="2026-09-22"
      generatedAt="2026-09-22T18:02:00Z" selectedEmployeeId="" onSelect={vi.fn()}/>);
    expect(screen.getByText('On break · App offline')).toBeVisible();
    expect(screen.queryByText('On duty · on break')).not.toBeInTheDocument();
  });
  it('does not call an online phone’s old GPS a live position', () => {
    render(<OfficerCards people={[{ ...officer, latitude: 25, longitude: 55, accuracy_m: 19,
      captured_at: '2026-09-22T17:50:00Z', last_reported_at: '2026-09-22T18:00:00Z', last_reported_accuracy_m: 146 }]}
      timezone="Asia/Dubai" date="2026-09-22" generatedAt="2026-09-22T18:02:00Z" selectedEmployeeId="" onSelect={vi.fn()}/>);
    expect(screen.getByText(/Online · App last checked in/)).toBeVisible();
    expect(screen.getByText('Phone online, but no recent reliable GPS. Last known position is historical; there is no current live map pin.')).toBeVisible();
    expect(screen.getByText(/last known position uses the earlier reliable fix/)).toBeVisible();
  });
});
