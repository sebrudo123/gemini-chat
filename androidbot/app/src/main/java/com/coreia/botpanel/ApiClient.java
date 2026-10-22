package com.coreia.botpanel;

import java.io.BufferedInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Llamadas GET autenticadas por Bearer hacia la API del backend. */
final class ApiClient {

    interface Callback {
        void onDone(int code, String body);
    }

    private ApiClient() {
        // Utilidad estática.
    }

    static void get(final String url, final String token, final Callback callback) {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent", "CoreIABotPanel-Android/1.0");
                if (token != null && !token.isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + token);
                }
                final int code = conn.getResponseCode();
                InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (in == null) in = conn.getInputStream();
                final StringBuilder buf = new StringBuilder();
                final InputStream stream = new BufferedInputStream(in);
                final byte[] chunk = new byte[8192];
                int n;
                while ((n = stream.read(chunk)) != -1) {
                    buf.append(new String(chunk, 0, n));
                }
                stream.close();
                callback.onDone(code, buf.toString());
            } catch (Exception e) {
                callback.onDone(-1, "");
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }
}
