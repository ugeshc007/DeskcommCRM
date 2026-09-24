package com.fieldcrm.sales;

import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.io.IOException;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public final class SyncEngine {
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();
    private static volatile boolean queued;
    private static boolean syncAgain;
    private static final ArrayList<Runnable> afterNextSync = new ArrayList<>();
    public static String validateBase(String input) throws Exception {
        URI uri = new URI(input.trim());
        boolean development = BuildConfig.DEBUG && "http".equals(uri.getScheme()) && ("127.0.0.1".equals(uri.getHost()) || "10.0.2.2".equals(uri.getHost()));
        if ((!"https".equals(uri.getScheme()) && !development) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null)
            throw new IllegalArgumentException("Use your CRM HTTPS address, without credentials or query parameters.");
        if (uri.getPath() != null && !uri.getPath().isEmpty() && !uri.getPath().equals("/")) throw new IllegalArgumentException("Use the CRM home address, not a page path.");
        return uri.toString().replaceAll("/+$", "");
    }
    /** A short code is exchanged once; it is never stored or sent as a bearer. */
    public static void pair(Context rawContext, String code, Runnable success, Runnable failure) {
        Context context = rawContext.getApplicationContext();
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                if (!code.matches("[0-9]{6}") || SecureState.read(context).has("token")) throw new IllegalArgumentException();
                String base = validateBase(BuildConfig.CRM_BASE_URL);
                connection = (HttpURLConnection) new URI(base + "/api/v1/field-sales/pair").toURL().openConnection();
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("Accept", "application/json");
                byte[] bytes = new JSONObject().put("code", code).toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                if (connection.getResponseCode() != 200) throw new SecurityException();
                try (InputStream input = connection.getInputStream()) {
                    java.io.ByteArrayOutputStream received = new java.io.ByteArrayOutputStream();
                    byte[] buffer = new byte[2048]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        received.write(buffer, 0, count);
                        if (received.size() > 16_384) throw new IllegalStateException();
                    }
                    String token = new JSONObject(new String(received.toByteArray(), StandardCharsets.UTF_8))
                        .getJSONObject("data").getString("token");
                    if (!token.matches("fld_[a-f0-9]{64}")) throw new SecurityException();
                    SecureState.mutate(context, state -> { state.put("server", base); state.put("token", token); });
                }
                success.run();
            } catch (Exception ignored) {
                // Never expose the code, token, response body or employee identity in logs.
                failure.run();
            } finally { if (connection != null) connection.disconnect(); }
        });
    }
    private static final class RetryableSyncException extends IllegalStateException {
        RetryableSyncException(String message) { super(message); }
    }
    private static JSONObject request(JSONObject state, String method, String suffix, JSONObject body) throws Exception {
        for (int attempt = 0; attempt < 3; attempt++) {
            try { return requestOnce(state, method, suffix, body); }
            catch (IOException | RetryableSyncException temporary) {
                if (attempt == 2) throw temporary;
                try { Thread.sleep(1000L << attempt); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw interrupted; }
            }
        }
        throw new IllegalStateException("Sync retry exhausted. Pending records are retained.");
    }
    private static JSONObject requestOnce(JSONObject state, String method, String suffix, JSONObject body) throws Exception {
        String base = validateBase(state.getString("server"));
        HttpURLConnection connection = (HttpURLConnection) new URI(base + "/api/v1/field-sales/mobile" + suffix).toURL().openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
        connection.setRequestMethod(method); connection.setRequestProperty("Authorization", "Bearer " + state.getString("token"));
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bytes.length);
                connection.setRequestProperty("Content-Type", "application/json");
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int code = connection.getResponseCode();
            if (code == 401 || code == 403) throw new SecurityException("Device access expired or was revoked. Reconnect from the CRM.");
            if (code >= 300 && code < 400) throw new IllegalStateException("The server redirected the request. Check the CRM address.");
            try (InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                if (stream == null) throw new IllegalStateException("Server unavailable. Pending records are retained.");
                java.io.ByteArrayOutputStream collected = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192]; int count;
                while ((count = stream.read(buffer)) != -1) {
                    collected.write(buffer, 0, count);
                    if (collected.size() > 1024 * 1024) throw new IllegalStateException("Server response is too large.");
                }
                byte[] bytes = collected.toByteArray();
                if (bytes.length > 1024 * 1024) throw new IllegalStateException("Server response is too large.");
                JSONObject response = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                if (code >= 400) {
                    String problem = response.optJSONObject("error") == null ? "sync_failed" : response.getJSONObject("error").optString("code", "sync_failed");
                    if (problem.equals("field_tracking_disabled")) throw new SecurityException("Tracking disabled by your organization. Punch out; contact your administrator.");
                    if (code == 429 || code >= 500) throw new RetryableSyncException("Sync needs attention (" + problem + "). Pending records are retained.");
                    throw new IllegalStateException("Sync needs attention (" + problem + "). Pending records are retained.");
                }
                return response.getJSONObject("data");
            }
        } finally { connection.disconnect(); }
    }
    public static synchronized boolean sync(Context rawContext, Runnable after) {
        if (queued) {
            syncAgain = true;
            if (after != null) afterNextSync.add(after);
            return false;
        }
        queued = true;
        Context context = rawContext.getApplicationContext();
        executor.execute(() -> {
            try {
                JSONObject state = SecureState.read(context);
                if (!state.has("token")) return;
                SecureState.mutate(context, current -> {
                    if (current.has("pending_visit")) {
                        JSONArray visits = current.optJSONArray("pending_visits");
                        if (visits == null) visits = new JSONArray();
                        visits.put(current.getJSONObject("pending_visit"));
                        current.put("pending_visits", visits); current.remove("pending_visit");
                    }
                });
                // Flush attendance first so every sample has its authoritative work interval.
                for (int i = 0; i < 100; i++) {
                    state = SecureState.read(context); JSONArray events = state.getJSONArray("events");
                    if (events.length() == 0) break;
                    JSONObject event = events.getJSONObject(0);
                    request(state, "POST", "", new JSONObject().put("operation", "attendance").put("command", event));
                    String id = event.getString("event_id");
                    SecureState.mutate(context, current -> { JSONArray pending = current.getJSONArray("events");
                        if (pending.length() > 0 && id.equals(pending.getJSONObject(0).getString("event_id"))) pending.remove(0); });
                }
                state = SecureState.read(context);
                if (state.getJSONArray("events").length() > 0) throw new IllegalStateException("Attendance sync is still pending.");
                String completionProblem = "";
                for (int i = 0; i < 100; i++) {
                    state = SecureState.read(context);
                    JSONArray activities = state.optJSONArray("pending_activities");
                    if (activities == null || activities.length() == 0) break;
                    JSONObject activity = activities.getJSONObject(0);
                    try { request(state, "POST", "", new JSONObject().put("operation", "activity").put("command", activity)); }
                    catch (SecurityException denied) { throw denied; }
                    catch (Exception failure) { completionProblem = "Activity notes are pending. Keep this phone connected and retry."; break; }
                    SecureState.mutate(context, current -> {
                        JSONArray pending = current.optJSONArray("pending_activities");
                        if (pending != null && pending.length() > 0 && pending.getJSONObject(0).getString("activity_id").equals(activity.getString("activity_id"))) pending.remove(0);
                    });
                }
                for (int i = 0; i < 100; i++) {
                    state = SecureState.read(context);
                    JSONArray visits = state.optJSONArray("pending_visits");
                    if (visits == null || visits.length() == 0) break;
                    JSONObject visit = visits.getJSONObject(0);
                    try { request(state, "POST", "", new JSONObject().put("operation", "visit").put("command", visit)); }
                    catch (SecurityException denied) { throw denied; }
                    catch (Exception failure) { completionProblem = "Visit steps are queued. Check connection and session times, then retry. GPS sync continues separately."; break; }
                    SecureState.mutate(context, current -> {
                        JSONArray pending = current.optJSONArray("pending_visits");
                        if (pending != null && pending.length() > 0 && pending.getJSONObject(0).getString("command_id").equals(visit.getString("command_id"))) pending.remove(0);
                    });
                }
                for (int i = 0; i < 100; i++) {
                    state = SecureState.read(context);
                    JSONArray collections = state.optJSONArray("pending_collections");
                    if (collections == null || collections.length() == 0) break;
                    JSONObject collection = collections.getJSONObject(0);
                    try { request(state, "POST", "", new JSONObject().put("operation", "collection").put("command", collection)); }
                    catch (SecurityException denied) { throw denied; }
                    catch (Exception failure) { completionProblem = "Shop visits or collections are pending. Keep this phone connected and retry."; break; }
                    SecureState.mutate(context, current -> {
                        JSONArray pending = current.optJSONArray("pending_collections");
                        if (pending != null && pending.length() > 0 && pending.getJSONObject(0).getString("collection_id").equals(collection.getString("collection_id"))) pending.remove(0);
                    });
                }
                for (int i = 0; i < 20; i++) {
                    state = SecureState.read(context);
                    JSONArray completions = state.optJSONArray("pending_completions");
                    if (completions == null || completions.length() == 0) break;
                    JSONObject completion = completions.getJSONObject(0);
                    try { request(state, "POST", "", new JSONObject().put("operation", "complete_next_action").put("command", completion)); }
                    catch (SecurityException denied) { throw denied; }
                    catch (Exception failure) {
                        completionProblem = "Follow-up completion is still pending. Review the refreshed visit or retry. GPS sync continues separately.";
                        break;
                    }
                    SecureState.mutate(context, current -> {
                        JSONArray pending = current.optJSONArray("pending_completions");
                        if (pending != null && pending.length() > 0 && pending.getJSONObject(0).toString().equals(completion.toString())) pending.remove(0);
                    });
                }
                for (int i = 0; i < 5; i++) {
                    state = SecureState.read(context);
                    JSONArray photos = state.optJSONArray("pending_photos");
                    if (photos == null || photos.length() == 0) break;
                    JSONObject photo = photos.getJSONObject(0);
                    try { request(state, "POST", "", new JSONObject().put("operation", "photo").put("command", photo)); }
                    catch (SecurityException denied) { throw denied; }
                    catch (Exception failure) { completionProblem = "Photos remain encrypted on this phone. Sync visit steps first, then retry photos. GPS sync continues separately."; break; }
                    SecureState.mutate(context, current -> {
                        JSONArray pending = current.optJSONArray("pending_photos");
                        if (pending != null && pending.length() > 0 && pending.getJSONObject(0).getString("id").equals(photo.getString("id"))) pending.remove(0);
                    });
                }
                // Bound each run, but drain more than one batch after an offline work session.
                for (int page = 0; page < 10; page++) {
                    state = SecureState.read(context);
                    JSONArray points = state.getJSONArray("points"), batch = new JSONArray();
                    java.util.Set<String> sent = new java.util.HashSet<>(), acknowledged = new java.util.HashSet<>();
                    for (int i = 0; i < Math.min(points.length(), 50); i++) { JSONObject point = points.getJSONObject(i); batch.put(point); sent.add(point.getString("sample_id")); }
                    if (batch.length() == 0) break;
                    JSONObject receipt = request(state, "POST", "", new JSONObject().put("operation", "locations").put("batch", new JSONObject().put("samples", batch)));
                    JSONArray accepted = receipt.getJSONArray("accepted"), rejected = receipt.optJSONArray("rejected");
                    if (rejected == null) rejected = new JSONArray();
                    for (int i = 0; i < accepted.length(); i++) acknowledged.add(accepted.getString(i));
                    for (int i = 0; i < rejected.length(); i++) acknowledged.add(rejected.getJSONObject(i).getString("sample_id"));
                    if (!sent.containsAll(acknowledged) || acknowledged.isEmpty()) throw new IllegalStateException("Invalid sync acknowledgement. Pending records are retained.");
                    final JSONArray rejectedRecords = rejected;
                    SecureState.mutate(context, current -> { JSONArray old = current.getJSONArray("points"), keep = new JSONArray();
                        for (int i = 0; i < old.length(); i++) if (!acknowledged.contains(old.getJSONObject(i).getString("sample_id"))) keep.put(old.getJSONObject(i));
                        current.put("points", keep);
                        // Retain reasons, never expired coordinates, for employee-visible recovery history.
                        JSONArray history = current.optJSONArray("gps_rejections");
                        if (history == null) history = new JSONArray();
                        for (int i = 0; i < rejectedRecords.length(); i++) history.put(new JSONObject()
                            .put("sample_id", rejectedRecords.getJSONObject(i).getString("sample_id"))
                            .put("reason", rejectedRecords.getJSONObject(i).getString("reason"))
                            .put("received_at", java.time.Instant.now().toString()));
                        while (history.length() > 100) history.remove(0);
                        current.put("gps_rejections", history);
                        current.put("gps_rejected_total", current.optInt("gps_rejected_total") + rejectedRecords.length());
                    });
                }
                state = SecureState.read(context);
                String zone = state.optString("timezone", "UTC");
                LocalDate today = LocalDate.now(ZoneId.of(zone));
                String shiftDate = state.optString("active_local_date", "");
                LocalDate from = shiftDate.isEmpty() ? today : LocalDate.parse(shiftDate);
                if (from.isAfter(today)) from = today;
                if (from.isBefore(today.minusDays(1))) from = today.minusDays(1);
                final JSONObject requestedState = state;
                JSONObject snapshot = request(state, "GET", "?from=" + from + "&through=" + today.plusDays(6), null);
                final String pendingCompletionMessage = completionProblem;
                SecureState.mutate(context, current -> {
                    current.put("snapshot", snapshot); current.put("last_sync", java.time.Instant.now().toString()); current.put("sync_error", pendingCompletionMessage);
                    current.put("identity", snapshot.getJSONObject("identity"));
                    JSONObject region = snapshot.optJSONObject("region");
                    if (region != null) current.put("timezone", region.getString("timezone"));
                    SessionSnapshot.apply(current, requestedState, snapshot.optJSONArray("sessions"));
                });
                JSONObject policy = snapshot.optJSONObject("settings");
                if (!WorkState.collecting(SecureState.read(context).optString("status")))
                    context.stopService(new Intent(context, TrackingService.class));
                if (policy == null || !policy.optBoolean("enabled")) {
                    context.stopService(new Intent(context, TrackingService.class));
                    SecureState.mutate(context, current -> current.put("sync_error", "Tracking is disabled by your organization. Punch out to close the session."));
                }
            } catch (SecurityException denied) {
                context.stopService(new Intent(context, TrackingService.class));
                try { SecureState.mutate(context, current -> { current.put("access_denied", true); current.put("sync_error", denied.getMessage()); }); } catch (Exception ignored) { }
            } catch (Exception failure) {
                // No credentials, GPS payloads or server response bodies in logs or crash reports.
                try { SecureState.mutate(context, current -> current.put("sync_error", failure instanceof IllegalStateException ? failure.getMessage() : "Offline or server unavailable. Pending records are retained.")); } catch (Exception ignored) { }
            } finally {
                boolean again; ArrayList<Runnable> callbacks;
                synchronized (SyncEngine.class) {
                    queued = false; again = syncAgain; syncAgain = false;
                    callbacks = new ArrayList<>(afterNextSync); afterNextSync.clear();
                }
                try { if (after != null) after.run(); }
                finally {
                    if (again) sync(context, () -> {
                        for (Runnable callback : callbacks) {
                            try { callback.run(); } catch (RuntimeException ignored) { /* Other callbacks still run. */ }
                        }
                    });
                }
            }
        });
        return true;
    }
    public static boolean hasPendingWork(JSONObject state) {
        return state.optJSONArray("events") != null && state.optJSONArray("events").length() > 0
            || state.optJSONArray("points") != null && state.optJSONArray("points").length() > 0
            || state.optJSONArray("pending_visits") != null && state.optJSONArray("pending_visits").length() > 0
            || state.optJSONArray("pending_collections") != null && state.optJSONArray("pending_collections").length() > 0
            || state.optJSONArray("pending_activities") != null && state.optJSONArray("pending_activities").length() > 0
            || state.optJSONArray("pending_completions") != null && state.optJSONArray("pending_completions").length() > 0
            || state.optJSONArray("pending_photos") != null && state.optJSONArray("pending_photos").length() > 0;
    }
    /** Revoke server access before erasing the only local credential. */
    public static synchronized void signOut(Context rawContext, Runnable after) {
        if (queued) return; queued = true; Context context = rawContext.getApplicationContext();
        executor.execute(() -> {
            try {
                JSONObject state = SecureState.read(context);
                if (!"off_duty".equals(state.optString("status")) || hasPendingWork(state)) throw new IllegalStateException("Pending work must sync first.");
                request(state, "POST", "", new JSONObject().put("operation", "sign_out")); SecureState.clear(context);
            } catch (Exception failure) {
                try { SecureState.mutate(context, current -> current.put("sync_error", "Sign out was not confirmed. Your account and pending data remain safely connected.")); } catch (Exception ignored) { }
            } finally { queued = false; if (after != null) after.run(); }
        });
    }
    /** Keep uncertain visit commands encrypted with their original idempotency identifiers. */
    public static void completeNextAction(Context context, JSONObject visit, Runnable after) throws Exception {
        JSONObject command = new JSONObject().put("visit_id", visit.getString("id")).put("revision", visit.getInt("revision"));
        SecureState.mutate(context, current -> {
            JSONArray queue = current.optJSONArray("pending_completions");
            if (queue == null) queue = new JSONArray();
            for (int i = 0; i < queue.length(); i++) if (queue.getJSONObject(i).getString("visit_id").equals(command.getString("visit_id"))) return;
            if (queue.length() >= 100) throw new IllegalStateException("Sync pending follow-ups before adding more.");
            queue.put(command); current.put("pending_completions", queue);
        });
        sync(context, after);
    }
    public static void visit(Context rawContext, JSONObject command, Runnable after) {
        Context context = rawContext.getApplicationContext();
        try {
            SecureState.mutate(context, current -> {
                JSONArray pending = current.optJSONArray("pending_visits");
                if (pending == null) pending = new JSONArray();
                if (pending.length() >= 100) throw new IllegalStateException("Sync the queued visit steps before adding more.");
                for (int i = 0; i < pending.length(); i++) if (pending.getJSONObject(i).getString("command_id").equals(command.getString("command_id"))) return;
                pending.put(command); current.put("pending_visits", pending);
                current.put("sync_error", "Visit step saved on this phone; awaiting server confirmation.");
            });
        } catch (Exception failure) {
            try { SecureState.mutate(context, current -> current.put("sync_error", "Visit step was not queued. Keep this screen open, sync and retry.")); } catch (Exception ignored) { }
        }
        if (after != null) after.run();
        sync(context, after);
    }

    /** One durable identifier per shop visit/payment; a retry can never reduce due twice. */
    public static void collection(Context rawContext, JSONObject command, Runnable after) throws Exception {
        Context context = rawContext.getApplicationContext();
        SecureState.mutate(context, current -> {
            JSONArray pending = current.optJSONArray("pending_collections");
            if (pending == null) pending = new JSONArray();
            if (pending.length() >= 100) throw new IllegalStateException("Sync queued shop records before adding more.");
            pending.put(command); current.put("pending_collections", pending);
            current.put("sync_error", "Shop record saved on this phone; awaiting server confirmation.");
        });
        if (after != null) after.run();
        sync(context, after);
    }

    /** Only confirmed text is queued. Raw microphone audio never enters durable state. */
    public static void activity(Context rawContext, JSONObject command, Runnable after) throws Exception {
        Context context = rawContext.getApplicationContext();
        SecureState.mutate(context, current -> {
            JSONArray pending = current.optJSONArray("pending_activities");
            if (pending == null) pending = new JSONArray();
            if (pending.length() >= 100) throw new IllegalStateException("Sync queued activity notes before adding more.");
            pending.put(command); current.put("pending_activities", pending);
            current.put("sync_error", "Activity note saved on this phone; awaiting server confirmation.");
        });
        if (after != null) after.run();
        sync(context, after);
    }

    /** Validate a replacement key before changing account scope or touching any pending records. */
    public static synchronized void reconnect(Context rawContext, String base, String token, Runnable after) {
        if (queued) return; queued = true;
        Context context = rawContext.getApplicationContext();
        executor.execute(() -> {
            try {
                JSONObject candidate = new JSONObject().put("server", validateBase(base)).put("token", token);
                LocalDate today = LocalDate.now(java.time.ZoneOffset.UTC);
                JSONObject snapshot = request(candidate, "GET", "?from=" + today + "&through=" + today.plusDays(6), null);
                JSONObject identity = snapshot.getJSONObject("identity");
                SecureState.mutate(context, current -> {
                    JSONObject old = current.optJSONObject("identity");
                    boolean pending = WorkState.collecting(current.getString("status")) || current.getJSONArray("events").length() > 0 || current.getJSONArray("points").length() > 0 || current.has("pending_visit")
                        || (current.optJSONArray("pending_completions") != null && current.getJSONArray("pending_completions").length() > 0)
                        || (current.optJSONArray("pending_visits") != null && current.getJSONArray("pending_visits").length() > 0)
                        || (current.optJSONArray("pending_collections") != null && current.getJSONArray("pending_collections").length() > 0)
                        || (current.optJSONArray("pending_photos") != null && current.getJSONArray("pending_photos").length() > 0);
                    boolean same = old != null && old.getString("organization_id").equals(identity.getString("organization_id"))
                        && old.getString("employee_id").equals(identity.getString("employee_id")) && current.optString("server").equals(candidate.getString("server"));
                    if (pending && !same) throw new IllegalStateException("Pending work belongs to the previous account. Reconnect that same organization and employee first.");
                    current.put("server", candidate.getString("server")); current.put("token", token);
                    current.put("identity", identity); current.put("snapshot", snapshot); current.put("access_denied", false); current.put("sync_error", "");
                    JSONObject region = snapshot.optJSONObject("region");
                    if (region != null) current.put("timezone", region.getString("timezone"));
                });
            } catch (Exception failure) {
                try { SecureState.mutate(context, current -> current.put("sync_error", "Reconnect failed. Check the key and use the same account if work is pending. No pending records were removed.")); } catch (Exception ignored) { }
            } finally { queued = false; if (after != null) after.run(); }
        });
    }
}
