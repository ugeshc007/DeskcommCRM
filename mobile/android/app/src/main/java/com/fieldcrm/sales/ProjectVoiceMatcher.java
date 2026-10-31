package com.fieldcrm.sales;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Recognition proposes one of the server-authorized projects; it never mutates work by itself. */
public final class ProjectVoiceMatcher {
    private ProjectVoiceMatcher() {}
    private static String normalize(String value) {
        return Normalizer.normalize(value.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "").replaceAll("[^a-z0-9]+", " ").trim().replaceAll(" +", " ");
    }
    public static int uniqueMatch(String transcript, List<String> projectNames) {
        String words = " " + normalize(transcript) + " ";
        if (words.trim().isEmpty()) return -1;
        List<Integer> matches = new ArrayList<>();
        for (int index = 0; index < projectNames.size(); index++) {
            String name = normalize(projectNames.get(index));
            if (name.length() >= 3 && words.contains(" " + name + " ")) matches.add(index);
        }
        return matches.size() == 1 ? matches.get(0) : -1;
    }
}
