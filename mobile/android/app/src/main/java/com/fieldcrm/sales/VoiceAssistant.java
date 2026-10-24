package com.fieldcrm.sales;

import android.content.Context;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Foreground-only, bounded speech. Temporary audio is removed after a response or cancellation. */
public final class VoiceAssistant {
    public interface Result { void received(String text); void unavailable(); }
    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private MediaRecorder recorder;
    private MediaPlayer promptPlayer;
    private volatile int promptGeneration;
    private File recording;
    public VoiceAssistant(Context context) { this.context = context.getApplicationContext(); }

    private HttpURLConnection open(String method, String suffix) throws Exception {
        JSONObject state = SecureState.read(context);
        String base = SyncEngine.validateBase(state.getString("server"));
        HttpURLConnection connection = (HttpURLConnection) new URI(base + "/api/v1/field-sales/voice" + suffix).toURL().openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(30000);
        connection.setRequestMethod(method); connection.setRequestProperty("Authorization", "Bearer " + state.getString("token"));
        return connection;
    }
    private HttpURLConnection open(String method) throws Exception { return open(method, ""); }
    public void playPrompt(boolean nextShop, Runnable completed, Runnable unavailable) {
        int generation = ++promptGeneration;
        executor.execute(() -> {
            File prompt = null; HttpURLConnection connection = null;
            try {
                connection = open("GET", nextShop ? "?kind=next" : "");
                if (connection.getResponseCode() != 200) throw new IllegalStateException();
                prompt = File.createTempFile("field-prompt-", ".wav", context.getCacheDir());
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(prompt)) {
                    byte[] buffer = new byte[8192]; int count, size = 0;
                    while ((count = input.read(buffer)) != -1) {
                        size += count; if (size > 256_000) throw new IllegalStateException(); output.write(buffer, 0, count);
                    }
                    if (size < 128) throw new IllegalStateException();
                }
                File playback = prompt;
                new Handler(Looper.getMainLooper()).post(() -> {
                    if (generation != promptGeneration) { playback.delete(); return; }
                    MediaPlayer player = new MediaPlayer();
                    try {
                        player.setDataSource(playback.getAbsolutePath()); player.prepare();
                        promptPlayer = player;
                        player.setOnCompletionListener(done -> {
                            promptPlayer = null; done.release(); playback.delete();
                            if (generation == promptGeneration) completed.run();
                        });
                        player.setOnErrorListener((failed, what, extra) -> {
                            promptPlayer = null; failed.release(); playback.delete();
                            if (generation == promptGeneration) unavailable.run();
                            return true;
                        });
                        player.start();
                    } catch (Exception failure) {
                        promptPlayer = null; player.release(); playback.delete();
                        if (generation == promptGeneration) unavailable.run();
                    }
                });
                prompt = null;
            } catch (Exception ignored) {
                new Handler(Looper.getMainLooper()).post(() -> { if (generation == promptGeneration) unavailable.run(); });
            }
            finally { if (connection != null) connection.disconnect(); if (prompt != null) prompt.delete(); }
        });
    }
    public boolean isRecording() { return recorder != null; }
    public void start() throws Exception {
        if (recorder != null) throw new IllegalStateException();
        recording = File.createTempFile("field-answer-", ".m4a", context.getCacheDir());
        try {
            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(context) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioEncodingBitRate(32_000); recorder.setAudioSamplingRate(16_000);
            recorder.setMaxDuration(8_000); recorder.setMaxFileSize(512_000);
            recorder.setOutputFile(recording.getAbsolutePath()); recorder.prepare(); recorder.start();
        } catch (Exception failure) { cancel(); throw failure; }
    }
    public void stop(Result callback) {
        if (recorder == null || recording == null) { callback.unavailable(); return; }
        int generation = promptGeneration;
        File clip = recording; recording = null;
        try { recorder.stop(); recorder.release(); recorder = null; }
        catch (Exception failure) { recorder.release(); recorder = null; clip.delete(); callback.unavailable(); return; }
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                if (generation != promptGeneration) return;
                byte[] bytes = Files.readAllBytes(clip.toPath());
                if (bytes.length < 128 || bytes.length > 512_000) throw new IllegalStateException();
                connection = open("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "audio/mp4"); connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                if (connection.getResponseCode() != 200) throw new IllegalStateException();
                try (InputStream input = connection.getInputStream()) {
                    java.io.ByteArrayOutputStream reply = new java.io.ByteArrayOutputStream();
                    byte[] buffer = new byte[512]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        reply.write(buffer, 0, count);
                        if (reply.size() > 2048) throw new IllegalStateException();
                    }
                    String text = new JSONObject(new String(reply.toByteArray(), StandardCharsets.UTF_8)).getJSONObject("data").getString("text");
                    if (generation == promptGeneration) callback.received(text);
                }
            } catch (Exception ignored) { if (generation == promptGeneration) callback.unavailable(); }
            finally { if (connection != null) connection.disconnect(); clip.delete(); }
        });
    }
    public void cancel() {
        promptGeneration++;
        if (promptPlayer != null) { promptPlayer.release(); promptPlayer = null; }
        if (recorder != null) { try { recorder.stop(); } catch (Exception ignored) { } recorder.release(); recorder = null; }
        if (recording != null) { recording.delete(); recording = null; }
    }
}
