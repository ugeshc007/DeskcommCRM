package com.fieldcrm.sales;

import static org.junit.Assert.*;
import org.junit.Test;

public final class GpsQualityTest {
    private static GpsQuality.Fix fix(long seconds, double lat, float accuracy) {
        return new GpsQuality.Fix(seconds * 1_000_000_000L, lat, 55, accuracy);
    }
    @Test public void staleAndPoorAccuracyAreFlagged() {
        GpsQuality.Result result = GpsQuality.evaluate(fix(1, 25, 140), null, 125_000_000_000L, null);
        assertTrue(result.flags.contains("stale"));
        assertTrue(result.flags.contains("poor_accuracy"));
    }
    @Test public void duplicatesAndOutOfOrderDoNotCountAsMotion() {
        GpsQuality.Fix first = fix(10, 25, 5);
        assertTrue(GpsQuality.evaluate(first, first, 11_000_000_000L, null).flags.contains("duplicate"));
        assertTrue(GpsQuality.evaluate(fix(9, 25.001, 5), first, 11_000_000_000L, null).flags.contains("out_of_order"));
    }
    @Test public void implausibleJumpAndStationaryDriftRemainRawButNotMotion() {
        GpsQuality.Fix first = fix(10, 25, 20);
        assertTrue(GpsQuality.evaluate(fix(13, 25.02, 20), first, 14_000_000_000L, null).flags.contains("implausible_jump"));
        assertFalse(GpsQuality.evaluate(fix(13, 25.0001, 20), first, 14_000_000_000L, null).moving);
        assertTrue(GpsQuality.evaluate(fix(13, 25.001, 5), first, 14_000_000_000L, 2f).moving);
    }
}
