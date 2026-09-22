import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OfficerCards } from './officer-cards';
import type { Operations } from './operations';

const officer: Operations['latest'][number] = { employee_id: 'officer-a', display_name: 'Synthetic officer', status: 'working',
  latitude: null, longitude: null, captured_at: null, accuracy_m: null, mock_location: null, online: true, last_seen_at: '2026-09-22T18:00:00Z' };

describe('duty cards when GPS is missing', () => {
  it('keeps a working officer visible and opens route history without requiring a map pin', async () => {
    const user = userEvent.setup(), select = vi.fn();
    render(<OfficerCards people={[officer]} timezone="Asia/Dubai" date="2026-09-22" selectedEmployeeId="" onSelect={select}/>);
    expect(screen.getByRole('heading', { name: 'On-duty officers · 1' })).toBeVisible();
    expect(screen.getByText('On duty · working')).toBeVisible();
    expect(screen.getByText(/waiting for the phone to send a GPS position/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'View route and visits' }));
    expect(select).toHaveBeenCalledWith('officer-a');
  });

  it('counts a break as on duty and keeps off-duty history available separately', async () => {
    const user = userEvent.setup();
    render(<OfficerCards people={[{ ...officer, status: 'break' }, { ...officer, employee_id: 'officer-b', display_name: 'Finished officer', status: null }]}
      timezone="Asia/Dubai" date="2026-09-22" selectedEmployeeId="" onSelect={vi.fn()}/>);
    expect(screen.getByText('On duty · on break')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'On-duty officers · 1' })).toBeVisible();
    await user.click(screen.getByText('Off-duty officers · 1'));
    const card = screen.getByRole('heading', { name: 'Finished officer' }).closest('article')!;
    expect(within(card).getByText('Off duty', { exact: true })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'View route and visits' })).toBeVisible();
  });
});
