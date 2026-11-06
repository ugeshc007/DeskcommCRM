import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ProjectStaff } from './project-staff';

const employees = [
  { user_id: 'officer-a', display_name: 'Aby', active: true, route_style_index: 0 },
  { user_id: 'officer-b', display_name: 'Jojo', active: true, route_style_index: 1 },
  { user_id: 'officer-c', display_name: 'Former officer', active: false, route_style_index: 2 },
];

describe('project staffing', () => {
  it('shows current workers separately from distinct active project assignments', () => {
    render(<ProjectStaff projectId="cherry" employees={employees} date="2026-10-14" loading={false} error={false}
      assignments={[
        { employee_id: 'officer-a', project_id: 'cherry', schedule: { start_date: '2026-10-01', end_date: null } },
        { employee_id: 'officer-a', project_id: 'cherry', schedule: { start_date: '2026-10-02', end_date: null } },
        { employee_id: 'officer-b', project_id: 'other', schedule: { start_date: '2026-10-01', end_date: null } },
        { employee_id: 'officer-c', project_id: 'cherry', schedule: { start_date: '2026-10-01', end_date: null } },
      ]}
      sessions={[
        { employee_id: 'officer-a', project_id: 'cherry', punched_out_at: null },
        { employee_id: 'officer-b', project_id: 'cherry', punched_out_at: '2026-10-14T09:00:00Z' },
      ]}/>);
    expect(within(screen.getByText('Working now · 1').parentElement!).getByText('Aby')).toBeVisible();
    expect(within(screen.getByText('Assigned officers · 1').parentElement!).getByText('Aby')).toBeVisible();
    expect(screen.queryByText('Jojo')).toBeNull();
    expect(screen.queryByText('Former officer')).toBeNull();
  });

  it('does not claim nobody is working while attendance cannot be read', () => {
    render(<ProjectStaff projectId="cherry" employees={employees} assignments={[]} sessions={[]}
      date="2026-10-14" loading={false} error/>);
    expect(screen.getByText('Attendance unavailable.')).toBeVisible();
    expect(screen.queryByText('No officer punched in to this project.')).toBeNull();
  });
});
