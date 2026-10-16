package com.coreia.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Servicio en primer plano que mantiene vivo el proceso (y por tanto el
 * WebView con Core IA) mientras la presencia de Discord está activa.
 *
 * Muestra una notificación permanente «Mostrando en Discord» con un botón
 * «Desactivar» que apaga tanto la presencia como este servicio.
 */
public class DiscordPresenceService extends Service {

    public static final String CHANNEL_ID = "coreia_discord_presence";
    public static final int NOTIFICATION_ID = 4201;

    public static void start(Context context) {
        Intent intent = new Intent(context, DiscordPresenceService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, DiscordPresenceService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        return START_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Presencia en Discord",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Muestra qué estás haciendo en Core IA dentro de Discord.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags);

        Intent stopIntent = new Intent(this, DiscordPresenceReceiver.class);
        stopIntent.setAction(DiscordPresenceReceiver.ACTION_DISABLE);
        PendingIntent stopPending = PendingIntent.getBroadcast(this, 1, stopIntent, pendingFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Mostrando en Discord")
                .setContentText("Core IA está compartiendo tu actividad.")
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .addAction(0, "Desactivar", stopPending)
                .build();
    }
}
