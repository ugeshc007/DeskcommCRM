import { z } from 'zod';
import { fail } from '@/lib/api/wrappers';
const noStore = { 'Cache-Control': 'private, no-store' };
export function fieldError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (error instanceof z.ZodError || error instanceof SyntaxError || code === 'invalid_request')
    return fail('validation_failed', 'Review the required fields, dates and recurring weekdays.', 422, { headers: noStore });
  if (code === 'field_forbidden') return fail('forbidden', 'You do not have access to this field team or operation.', 403, { headers: noStore });
  const messages: Record<string, string> = {
    field_photo_invalid: 'Choose a JPEG, PNG or WebP photo up to 1 MiB and 16 megapixels.',
    field_photo_limit: 'This visit already has the maximum of 20 photos.',
    field_work_session_required: 'Punch in and end your break before recording work at a project.',
    field_visit_outcome_required: 'Enter the visit outcome or the reason for skipping.',
    field_next_action_date_required: 'Choose when the next action is due.',
    field_closed_session_required: 'Only your own completed work session can be corrected.',
    field_invalid_correction: 'Correction times must be ordered and cannot be in the future.',
    field_operations_too_large: 'Too many records. Select a narrower date or session.',
    field_invalid_transition: 'This work step is no longer available. Refresh before continuing.',
    field_idempotency_conflict: 'This request was already used for different content. Refresh before retrying.',
    field_revision_conflict: 'This record changed. Refresh before saving again.',
    field_region_required: 'Configure country and time zone in the CRM organization settings first.',
    field_policy_required: 'Save the employee notice and retention settings under Tracking policy before configuring the map.',
    field_employee_unavailable: 'Choose an active enrolled employee in this organization.',
    field_leave_has_work: 'This officer has a recorded work session on that date. Review the punch before approving leave.',
    field_customer_unavailable: 'The selected customer is not available in this organization.',
    field_customers_too_large: 'This project has too many active shops for one request. Archive older shops or split the project.',
    field_amount_out_of_range: 'The amount or resulting balance is outside the supported range.',
    field_project_unavailable: 'Choose an active project in this organization.',
    field_assignment_unavailable: 'This assignment is not available. Refresh the calendar.',
    field_history_immutable: 'This assignment already has recorded work or changes. It cannot be rewritten in place; earlier history must be preserved.',
    field_series_edit_requires_scope: 'Use an occurrence or future-series edit; existing history must be preserved.',
    field_invalid_edit_scope: 'The replacement must start on the selected date. Review its recurring weekdays.',
    field_calendar_window_too_large: 'Choose a calendar window of at most 93 days.',
    field_calendar_too_large: 'This calendar needs narrower filters before it can be loaded.',
    field_nonexistent_local_time: 'This local time does not exist because of a daylight-saving change.',
    field_ambiguous_local_time: 'This local time occurs twice. Choose an unambiguous time.',
  };
  if (messages[code]) return fail('state_conflict', messages[code], 409, { headers: noStore });
  return fail('service_unavailable', 'Field Sales is unavailable. Refresh before retrying; existing records are preserved.', 503, { headers: noStore });
}
