package com.coreia.botpanel;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Poller de eventos del bot: consulta el panel cada ~15 min y avisa con una
 * notificación local cuando hay actividad nueva (bienvenidas, moderación,
 * raid, errores…). Es "push sin servidor de push": gratis y sin tokens.
 */
public class NotifierWorker extends Worker {

    public static final String CHANNEL_ID = "coreia-bot-actividad";
    private static final int NOTIF_ID = 1001;
    static final String KEY_LAST_EVENT = "notif_last_event";

    public NotifierWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        final Context context = getApplicationContext();
        final SharedPreferences prefs = context.getSharedPreferences(
            LoginActivity.PREFS_NAME, Context.MODE_PRIVATE);
        final String token = prefs.getString(LoginActivity.KEY_TOKEN_CACHE, "");
        final String base = LoginActivity.apiBase();
        if (token.isEmpty() || base.isEmpty()) {
            return Result.success(); // sin sesión: nada que consultar
        }

        final int[] codeRef = { 0 };
        final Object[] newestRef = { null };
        final CountDownLatch latch = new CountDownLatch(1);
        ApiClient.get(base + "/api/admin/discord-bot/events?limit=20", token,
            (code, body) -> {
                codeRef[0] = code;
                newestRef[0] = newestEvent(body);
                latch.countDown();
            });
        try {
            if (!latch.await(20, TimeUnit.SECONDS)) {
                return Result.retry();
            }
        } catch (InterruptedException e) {
            return Result.retry();
        }
        if (codeRef[0] != 200) {
            return Result.retry();
        }
        final String[] newest = (String[]) newestRef[0];
        if (newest == null) {
            return Result.success(); // sin eventos todavía
        }
        final String lastShown = prefs.getString(KEY_LAST_EVENT, "");
        if (newest[0].equals(lastShown)) {
            return Result.success(); // nada nuevo desde la última notificación
        }
        prefs.edit().putString(KEY_LAST_EVENT, newest[0]).apply();
        // Solo avisa si ya había una marca anterior: en la primera corrida no
        // debe molestar con el último evento viejo.
        if (lastShown != null && !lastShown.isEmpty()) {
            notify(context, labelDe(newest[1]), newest[2]);
        }
        return Result.success();
    }

    /** [ timestamp, etiqueta, detalle ] del evento más nuevo, o null. */
    private static String[] newestEvent(String body) {
        try {
            final JSONObject root = new JSONObject(body);
            final JSONArray list = root.optJSONArray("events");
            if (list == null || list.length() == 0) return null;
            final JSONObject e = list.getJSONObject(0);
            return new String[] {
                e.optString("t", ""),
                e.optString("kind", ""),
                e.optString("detail", ""),
            };
        } catch (Exception err) {
            return null;
        }
    }

    /** Etiquetas legibles por clase de evento (español). */
    private static String labelDe(String kind) {
        if (kind == null) return "Actividad del bot";
        switch (kind) {
            case "welcome": return "👋 Nueva bienvenida";
            case "welcome_dm": return "📩 MP de bienvenida";
            case "verification": return "✅ Nueva verificación";
            case "moderation": return "🛡️ Acción de moderación";
            case "aimod": return "🤖 Moderación IA";
            case "raid": return "🚨 Posible raid detectada";
            case "bot_error": return "⚠️ Error del bot";
            case "bot_restarted": return "🔄 El bot se reinició";
            default: return "💬 Actividad del bot";
        }
    }

    private static void notify(Context context, String title, String detail) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(context,
                Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        final NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL_ID, "Actividad del bot",
                NotificationManager.IMPORTANCE_DEFAULT));
        }
        final NotificationCompat.Builder builder = new NotificationCompat.Builder(
            context, CHANNEL_ID)
            .setSmallIcon(com.coreia.botpanel.R.drawable.ic_launcher)
            .setContentTitle(title)
            .setContentText(detail == null || detail.isEmpty()
                ? "Toca para abrir el panel" : detail)
            .setAutoCancel(true);
        manager.notify(NOTIF_ID, builder.build());
    }
}
