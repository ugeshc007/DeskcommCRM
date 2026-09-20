package com.fieldcrm.sales;
import org.junit.Test;
import static org.junit.Assert.*;
public class WorkStateTest {
    @Test public void disabledPolicyCannotBeBypassedByResume() {
        assertTrue(WorkState.mayCollect("working", false, true));
        assertTrue(WorkState.mayCollect("on_break", false, true));
        assertFalse(WorkState.mayCollect("working", false, false));
        assertFalse(WorkState.mayCollect("on_break", true, true));
        assertFalse(WorkState.mayCollect("off_duty", false, true));
    }
    @Test public void breaksContinueButPunchOutStops() {
        String status = WorkState.transition("off_duty", "punch_in"); assertTrue(WorkState.collecting(status));
        status = WorkState.transition(status, "break_start"); assertTrue(WorkState.collecting(status));
        status = WorkState.transition(status, "punch_out"); assertFalse(WorkState.collecting(status));
    }
    @Test(expected=IllegalStateException.class) public void cannotPunchInTwice() { WorkState.transition("working", "punch_in"); }
    @Test(expected=IllegalStateException.class) public void cannotBreakWhenOffDuty() { WorkState.transition("off_duty", "break_start"); }
}
