package com.fieldcrm.sales;

import static org.junit.Assert.assertEquals;
import java.util.Arrays;
import org.junit.Test;

public class ProjectVoiceMatcherTest {
    @Test public void matchesOnlyOneAssignedName() {
        assertEquals(0, ProjectVoiceMatcher.uniqueMatch("I am going to Cherry now", Arrays.asList("Cherry", "UWINN")));
        assertEquals(1, ProjectVoiceMatcher.uniqueMatch("UWINN project", Arrays.asList("Cherry", "UWINN")));
    }
    @Test public void rejectsUnassignedAndAmbiguousAnswers() {
        assertEquals(-1, ProjectVoiceMatcher.uniqueMatch("a different shop", Arrays.asList("Cherry", "UWINN")));
        assertEquals(-1, ProjectVoiceMatcher.uniqueMatch("Cherry and UWINN", Arrays.asList("Cherry", "UWINN")));
        assertEquals(-1, ProjectVoiceMatcher.uniqueMatch("Cherry", Arrays.asList("Cherry", "Cherry")));
        assertEquals(0, ProjectVoiceMatcher.uniqueMatch("I am going to Cherry Shop now", Arrays.asList("Cherry Shop", "UWINN Market")));
        assertEquals(-1, ProjectVoiceMatcher.uniqueMatch("Cherry Shop and UWINN Market", Arrays.asList("Cherry Shop", "UWINN Market")));
    }
}
