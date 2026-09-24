package com.fieldcrm.sales;

import java.util.ArrayList;
import java.util.List;

/** Measured-fix checks; neither coordinates nor timestamps are changed. */
final class GpsQuality {
    static final long MAX_FIX_AGE_MS = 120_000L;
    static final float MAX_LIVE_ACCURACY_M = 100f;
    static final double MAX_PLAUSIBLE_SPEED_M_S = 55d;
    static final long MOVING_INTERVAL_MS = 3_000L;
    static final long STATIONARY_INTERVAL_MS = 30_000L;

    static final class Fix {
        final long elapsedNanos;
        final double latitude, longitude;
        final float accuracyM;
        Fix(long elapsedNanos, double latitude, double longitude, float accuracyM) {
            this.elapsedNanos = elapsedNanos; this.latitude = latitude; this.longitude = longitude; this.accuracyM = accuracyM;
        }
    }

    static final class Result {
        final List<String> flags;
        final boolean moving;
        final long ageMs;
        Result(List<String> flags, boolean moving, long ageMs) { this.flags = flags; this.moving = moving; this.ageMs = ageMs; }
    }

    private static double metres(Fix a, Fix b) {
        double lat = Math.toRadians(b.latitude - a.latitude), lon = Math.toRadians(b.longitude - a.longitude);
        double middle = Math.toRadians((a.latitude + b.latitude) / 2);
        double sine = Math.pow(Math.sin(lat / 2), 2) + Math.cos(middle) * Math.cos(middle) * Math.pow(Math.sin(lon / 2), 2);
        return 12_742_000d * Math.atan2(Math.sqrt(sine), Math.sqrt(Math.max(0, 1 - sine)));
    }

    static Result evaluate(Fix current, Fix previous, long nowElapsedNanos, Float speedMps) {
        return evaluate(current, previous, nowElapsedNanos, speedMps, MAX_LIVE_ACCURACY_M, MAX_PLAUSIBLE_SPEED_M_S);
    }
    static Result evaluate(Fix current, Fix previous, long nowElapsedNanos, Float speedMps,
                           float maxAccuracyM, double maxSpeedMps) {
        ArrayList<String> flags = new ArrayList<>();
        long ageMs = (nowElapsedNanos - current.elapsedNanos) / 1_000_000L;
        if (ageMs > MAX_FIX_AGE_MS || ageMs < -5_000L) flags.add("stale");
        if (current.accuracyM > maxAccuracyM) flags.add("poor_accuracy");
        if (previous != null) {
            long elapsed = current.elapsedNanos - previous.elapsedNanos;
            if (elapsed == 0 && current.latitude == previous.latitude && current.longitude == previous.longitude) flags.add("duplicate");
            else if (elapsed <= 0) flags.add("out_of_order");
            else {
                double minimumTravel = Math.max(0, metres(previous, current) - previous.accuracyM - current.accuracyM);
                if (minimumTravel / (elapsed / 1_000_000_000d) > maxSpeedMps) flags.add("implausible_jump");
            }
        }
        boolean moving = flags.isEmpty() && ((speedMps != null && speedMps > 1.5f)
            || (previous != null && current.elapsedNanos > previous.elapsedNanos
            && metres(previous, current) > previous.accuracyM + current.accuracyM + 5));
        return new Result(flags, moving, Math.max(0, ageMs));
    }
}
