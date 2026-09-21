package com.fieldcrm.sales;

import android.app.job.*;
import android.content.ComponentName;
import android.content.Context;

/** Network-only retries. This job never starts the GPS service or changes attendance. */
public final class SyncJobService extends JobService {
    public static void schedule(Context context) {
        try {
            JobScheduler scheduler = context.getSystemService(JobScheduler.class);
            int result = scheduler.schedule(new JobInfo.Builder(102, new ComponentName(context, SyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).build());
            if (result != JobScheduler.RESULT_SUCCESS) throw new IllegalStateException("Background retry unavailable");
        } catch (RuntimeException failure) {
            try { SecureState.mutate(context, state -> state.put("sync_error", "Background retry could not be scheduled. Open the app and use Sync now.")); } catch (Exception ignored) { }
        }
    }
    @Override public boolean onStartJob(JobParameters parameters) {
        try { Attendance.autoPunchOut(this); } catch (Exception ignored) { }
        return SyncEngine.sync(this, () -> jobFinished(parameters, false));
    }
    @Override public boolean onStopJob(JobParameters parameters) { return true; }
}
