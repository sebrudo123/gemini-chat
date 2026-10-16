package com.coreia.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Recibe la acción «Desactivar» de la notificación de presencia y apaga el RPC.
 */
public class DiscordPresenceReceiver extends BroadcastReceiver {

    public static final String ACTION_DISABLE = "com.coreia.app.action.DISABLE_DISCORD_PRESENCE";

    @Override
    public void onReceive(Context context, Intent intent) {
        DiscordRpc.disableFromNotification(context);
    }
}
