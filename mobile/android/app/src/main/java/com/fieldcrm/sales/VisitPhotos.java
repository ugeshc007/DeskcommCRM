package com.fieldcrm.sales;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** User-selected photos only; no gallery scan or stored image-location metadata. */
public final class VisitPhotos {
    public static void select(Context context, Uri uri, String visitId) throws Exception {
        byte[] bytes;
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalArgumentException("Unable to open image.");
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) {
                out.write(buffer, 0, count);
                if (out.size() > 12 * 1024 * 1024) throw new IllegalArgumentException("Select an image smaller than 12 MiB.");
            }
            bytes = out.toByteArray();
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IllegalArgumentException("Select a supported image.");
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > 1200) options.inSampleSize *= 2;
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) throw new IllegalArgumentException("Unable to decode image.");
        try { queue(context, bitmap, visitId); } finally { bitmap.recycle(); }
    }
    public static void queue(Context context, Bitmap bitmap, String visitId) throws Exception {
        int longest = Math.max(bitmap.getWidth(), bitmap.getHeight());
        Bitmap scaled = longest > 1200 ? Bitmap.createScaledBitmap(bitmap, Math.max(1, bitmap.getWidth() * 1200 / longest), Math.max(1, bitmap.getHeight() * 1200 / longest), true) : bitmap;
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try { scaled.compress(Bitmap.CompressFormat.JPEG, 70, output); } finally { if (scaled != bitmap) scaled.recycle(); }
        if (output.size() > 262144) throw new IllegalArgumentException("Photo is too detailed. Choose a smaller image (compressed limit 256 KiB).");
        JSONObject command = new JSONObject().put("id", java.util.UUID.randomUUID().toString()).put("visit_id", visitId)
            .put("captured_at", java.time.Instant.now().toString()).put("image_base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
        SecureState.mutate(context, state -> {
            JSONArray queue = state.optJSONArray("pending_photos"); if (queue == null) queue = new JSONArray();
            if (queue.length() >= 5) throw new IllegalStateException("Sync the five pending photos before adding more.");
            queue.put(command); state.put("pending_photos", queue);
        });
    }
}
