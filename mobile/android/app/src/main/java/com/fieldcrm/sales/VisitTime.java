package com.fieldcrm.sales;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;

/** Organization wall time, never the phone's default zone. */
public final class VisitTime {
    private VisitTime() { }
    public static String toInstant(LocalDateTime local, String timezone) {
        List<ZoneOffset> offsets = ZoneId.of(timezone).getRules().getValidOffsets(local);
        if (offsets.size() != 1) throw new IllegalArgumentException("Choose an unambiguous time outside the daylight-saving change.");
        return local.toInstant(offsets.get(0)).toString();
    }
}
