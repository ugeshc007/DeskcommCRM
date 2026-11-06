package com.fieldcrm.sales;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

/** Tokens, cached assignments and offline coordinates never reach plaintext preferences. */
public final class SecureState {
    private static final String ALIAS = "field_sales_private_state_v1";
    public interface Mutation { void apply(JSONObject state) throws Exception; }
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    public static synchronized JSONObject read(Context context) throws Exception {
        String data = context.getSharedPreferences("field_sales", Context.MODE_PRIVATE).getString("encrypted", null);
        if (data == null) return new JSONObject().put("status", "off_duty").put("events", new JSONArray()).put("points", new JSONArray());
        String[] parts = data.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
    }
    public static synchronized void mutate(Context context, Mutation mutation) throws Exception {
        JSONObject state = read(context); mutation.apply(state);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(state.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!context.getSharedPreferences("field_sales", Context.MODE_PRIVATE).edit().putString("encrypted", encoded).commit())
            throw new IllegalStateException("Unable to save safely. Tracking cannot continue.");
    }
    public static synchronized void clear(Context context) throws Exception {
        if (!context.getSharedPreferences("field_sales", Context.MODE_PRIVATE).edit().clear().commit()) throw new IllegalStateException("Unable to clear secure state.");
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS);
    }
}
