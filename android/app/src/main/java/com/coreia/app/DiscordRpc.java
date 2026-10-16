package com.coreia.app;

import android.app.Activity;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Discord Rich Presence mediante el SDK oficial de Discord (Social SDK).
 *
 * La capa Java del SDK no expone la presencia, así que delegamos en un módulo
 * nativo C++ (ver {@code src/main/cpp/discord_rpc.cpp}) que usa la API
 * {@code discordpp}. Si la librería nativa o el SDK no están disponibles, todo
 * se convierte en un no-op silencioso para no afectar al resto de la app.
 *
 * Mientras la presencia está activa se mantiene un servicio en primer plano con
 * una notificación «Mostrando en Discord» y un botón «Desactivar».
 */
public final class DiscordRpc {

    private static final String TAG = "CoreIA.DiscordRpc";
    private static final long PUMP_INTERVAL_MS = 500L;

    private static boolean libraryLoaded = false;
    private static boolean initialized = false;
    private static String currentAppId = null;
    private static String statusMessage = "sin inicializar";
    private static Handler pumpHandler;
    private static Runnable pumpRunnable;

    static {
        try {
            System.loadLibrary("coreia_rpc");
            libraryLoaded = true;
        } catch (Throwable error) {
            Log.w(TAG, "Librería nativa de Discord no disponible: " + error);
            libraryLoaded = false;
        }
    }

    private DiscordRpc() {
    }

    /** Indica si la presencia puede usarse en este dispositivo/compilación. */
    public static boolean isAvailable() {
        return libraryLoaded;
    }

    /** Estado legible para mostrar en Ajustes. */
    public static synchronized String getStatus() {
        if (!libraryLoaded) {
            return "no disponible";
        }
        return statusMessage;
    }

    /**
     * Inicializa la presencia con el Application ID de Discord.
     *
     * @return {@code true} si el RPC quedó operativo.
     */
    public static synchronized boolean init(Activity activity, String appId) {
        if (!libraryLoaded) {
            statusMessage = "SDK nativo no disponible";
            return false;
        }
        if (appId == null || appId.trim().isEmpty()) {
            statusMessage = "falta el Application ID";
            return false;
        }
        if (initialized && appId.equals(currentAppId)) {
            return true;
        }

        // El SDK necesita el contexto de Android antes de crear el cliente.
        try {
            Class<?> initClass = Class.forName("com.discord.socialsdk.DiscordSocialSdkInit");
            initClass.getMethod("setEngineActivity", Activity.class).invoke(null, activity);
        } catch (Throwable error) {
            Log.w(TAG, "setEngineActivity falló: " + error);
            statusMessage = "SDK de Discord no cargó";
            return false;
        }

        try {
            boolean ok = nativeInit(appId.trim());
            initialized = ok;
            currentAppId = ok ? appId.trim() : null;
            statusMessage = ok ? "activo (Application ID " + currentAppId + ")" : "no se pudo iniciar";
            if (ok) {
                startPump();
                DiscordPresenceService.start(activity);
            }
            return ok;
        } catch (Throwable error) {
            Log.w(TAG, "init falló: " + error);
            initialized = false;
            currentAppId = null;
            statusMessage = "error: " + error;
            return false;
        }
    }

    /** Actualiza los textos de la presencia (details/state). */
    public static synchronized void update(String details, String state) {
        if (!initialized) {
            return;
        }
        try {
            nativeUpdate(details, state);
        } catch (Throwable error) {
            Log.w(TAG, "update falló: " + error);
        }
    }

    /** Detiene la presencia y libera los recursos nativos. */
    public static synchronized void shutdown() {
        stopPump();
        if (!initialized) {
            statusMessage = libraryLoaded ? "desactivado" : "no disponible";
            return;
        }
        try {
            nativeShutdown();
        } catch (Throwable error) {
            Log.w(TAG, "shutdown falló: " + error);
        }
        initialized = false;
        currentAppId = null;
        statusMessage = "desactivado";
    }

    /** Apaga el RPC y el servicio cuando se pulsa «Desactivar» en la notificación. */
    public static void disableFromNotification(Context context) {
        shutdown();
        DiscordPresenceService.stop(context);
        MainActivity.notifyPresenceStopped();
    }

    private static void startPump() {
        stopPump();
        pumpHandler = new Handler(Looper.getMainLooper());
        pumpRunnable = new Runnable() {
            @Override
            public void run() {
                if (!initialized) {
                    return;
                }
                try {
                    nativeRunCallbacks();
                } catch (Throwable ignored) {
                    // sin SDK: ignorar
                }
                if (pumpHandler != null) {
                    pumpHandler.postDelayed(this, PUMP_INTERVAL_MS);
                }
            }
        };
        pumpHandler.postDelayed(pumpRunnable, PUMP_INTERVAL_MS);
    }

    private static void stopPump() {
        if (pumpHandler != null && pumpRunnable != null) {
            pumpHandler.removeCallbacks(pumpRunnable);
        }
        pumpHandler = null;
        pumpRunnable = null;
    }

    private static native boolean nativeInit(String appId);

    private static native void nativeUpdate(String details, String state);

    private static native void nativeRunCallbacks();

    private static native void nativeShutdown();
}
