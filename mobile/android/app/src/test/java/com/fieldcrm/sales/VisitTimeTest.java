package com.fieldcrm.sales;

import org.junit.Test;
import static org.junit.Assert.*;
import java.time.LocalDateTime;
import java.util.TimeZone;

public class VisitTimeTest {
    @Test public void usesOrganizationZoneNotDevice() {
        TimeZone before = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));
            assertEquals("2026-09-21T05:30:00Z", VisitTime.toInstant(LocalDateTime.parse("2026-09-21T09:30"), "Asia/Dubai"));
        } finally { TimeZone.setDefault(before); }
    }
    @Test public void rejectsDaylightSavingGapAndOverlap() {
        assertThrows(IllegalArgumentException.class, () -> VisitTime.toInstant(LocalDateTime.parse("2026-03-08T02:30"), "America/New_York"));
        assertThrows(IllegalArgumentException.class, () -> VisitTime.toInstant(LocalDateTime.parse("2026-11-01T01:30"), "America/New_York"));
    }
}
