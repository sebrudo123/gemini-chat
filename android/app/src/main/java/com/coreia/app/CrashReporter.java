package com.coreia.app;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Guarda el motivo del cierre anterior de la app (excepción Java o caída nativa)
 * para poder mostrar un diagnóstico al volver a abrirla.
 */
public final class CrashReporter {

    private static final String PREFS = "coreia_diag";
    private static final String KEY_JAVA = "last_java_crash";

    private CrashReporter() {
    }

    /** Instala el capturador de excepciones no controladas. */
    public static void install(final Context context) {
        final Context app = context.getApplicationContext();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter writer = new StringWriter();
                error.printStackTrace(new PrintWriter(writer));
                app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .putString(KEY_JAVA, "[" + new Date() + "] hilo " + thread.getName() + "\n" + writer)
                        .apply();
            } catch (Throwable ignored) {
                // nunca fallar dentro del manejador
            }
            if (previous != null) {
                previous.uncaughtException(thread, error);
            }
        });
    }

    /** Devuelve el informe del último cierre, o {@code null} si no hubo ninguno. */
    public static String lastReport(Context context) {
        StringBuilder out = new StringBuilder();

        String javaCrash = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_JAVA, null);
        if (javaCrash != null && !javaCrash.isEmpty()) {
            out.append("== Excepción Java ==\n").append(javaCrash).append("\n\n");
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                ActivityManager manager = context.getSystemService(ActivityManager.class);
                if (manager != null) {
                    List<ActivityManager.ApplicationExitInfo> infos =
                            manager.getHistoricalProcessExitReasons(context.getPackageName(), 0, 6);
                    for (ActivityManager.ApplicationExitInfo info : infos) {
                        int reason = info.getReason();
                        boolean interesting = reason == ActivityManager.ApplicationExitInfo.REASON_CRASH_NATIVE
                                || reason == ActivityManager.ApplicationExitInfo.REASON_CRASH
                                || reason == ActivityManager.ApplicationExitInfo.REASON_ANR;
                        if (!interesting) {
                            continue;
                        }
                        out.append("== Salida del proceso ==\n")
                                .append(String.format(
                                        Locale.US,
                                        "motivo=%d (%s)  descripción=%s  fecha=%s%n",
                                        reason,
                                        reasonName(reason),
                                        String.valueOf(info.getDescription()),
                                        new Date(info.getTimestamp())));
                        try (InputStream stream = info.getTraceInputStream()) {
                            if (stream != null) {
                                String trace = readAll(stream);
                                if (!trace.isEmpty()) {
                                    out.append(trace).append("\n");
                                }
                            }
                        } catch (Throwable ignored) {
                            // sin traza disponible
                        }
                    }
                }
            } catch (Throwable ignored) {
                // API no disponible
            }
        }

        String report = out.toString().trim();
        return report.isEmpty() ? null : report;
    }

    /** Borra el informe guardado. */
    public static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    private static String reasonName(int reason) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return String.valueOf(reason);
        }
        switch (reason) {
            case ActivityManager.ApplicationExitInfo.REASON_CRASH:
                return "crash Java";
            case ActivityManager.ApplicationExitInfo.REASON_CRASH_NATIVE:
                return "crash nativo";
            case ActivityManager.ApplicationExitInfo.REASON_ANR:
                return "ANR";
            default:
                return String.valueOf(reason);
        }
    }

    private static String readAll(InputStream stream) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        int total = 0;
        while ((read = stream.read(chunk)) != -1 && total < 200000) {
            buffer.write(chunk, 0, read);
            total += read;
        }
        return buffer.toString("UTF-8");
    }
}
