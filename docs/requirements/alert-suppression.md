# Alert Suppression and Reminder Notes

This memo captures the initial design for alert suppression and reminders.

## Suppression Key
- Use a stable key to avoid duplicate alerts for the same condition.
- Key: `(alert_setting_id, target_ref)`

## Open Alert Behavior
- If an open alert exists for the same key, do not create a new alert.
- Instead, check whether a reminder is due.

## Reminder
- Add `remindAfterHours` (setting-level or default) for reminder timing.
- Store `reminderAt` on the alert when it is created.
- When `now >= reminderAt` and alert is still open, resend notifications and set `reminderAt = now + remindAfterHours`.

## Close Conditions
- Close an alert when the metric returns below threshold.
- Optionally allow manual close from the dashboard.

## Audit
- Record reminder sends in `sentResult`.
- Keep alert history for reporting.
