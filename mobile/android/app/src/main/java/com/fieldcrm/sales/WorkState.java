package com.fieldcrm.sales;

/** Pure contract, shared by UI and the collection service. */
public final class WorkState {
    private WorkState() {}
    public static String transition(String status, String action) {
        if (status.equals("off_duty") && action.equals("punch_in")) return "working";
        if (collecting(status) && action.equals("select_project")) return status;
        if (status.equals("working") && action.equals("break_start")) return "on_break";
        if (status.equals("on_break") && action.equals("break_end")) return "working";
        if (!status.equals("off_duty") && action.equals("punch_out")) return "off_duty";
        throw new IllegalStateException("Invalid work-session transition");
    }
    public static boolean collecting(String status) { return status.equals("working") || status.equals("on_break"); }
    public static boolean mayCollect(String status, boolean accessDenied, boolean policyEnabled) {
        return collecting(status) && !accessDenied && policyEnabled;
    }
}
