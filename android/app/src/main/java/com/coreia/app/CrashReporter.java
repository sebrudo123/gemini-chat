package com.coreia.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Guarda el motivo del cierre anterior de la app (excepción Java, caída nativa
 * o ANR) para poder mostrar un diagnóstico al volver a abrirla.
 *
 * Para las caídas nativas se adjunta el registro del propio proceso (logcat),
 * que es donde Chromium/WebView escribe la causa exacta antes de abortar.
 */
public final class CrashReporter {

    private static final String PREFS = "coreia_diag";
    private static final String KEY_JAVA = "last_java_crash";
    private static final String KEY_LAST_SEEN = "last_seen_exit";
    private static final String FILE_NAME = "coreia-diagnostico.txt";
    private static final int MAX_TRACE_CHARS = 6000;

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

        long lastSeen = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getLong(KEY_LAST_SEEN, 0L);
        long newest = lastSeen;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                ActivityManager manager = context.getSystemService(ActivityManager.class);
                if (manager != null) {
                    List<ApplicationExitInfo> infos =
                            manager.getHistoricalProcessExitReasons(context.getPackageName(), 0, 6);
                    for (ApplicationExitInfo info : infos) {
                        // Solo se informa de los cierres ocurridos desde el último arranque.
                        if (info.getTimestamp() <= lastSeen) {
                            continue;
                        }
                        newest = Math.max(newest, info.getTimestamp());
                        int reason = info.getReason();
                        boolean interesting = reason == ApplicationExitInfo.REASON_CRASH_NATIVE
                                || reason == ApplicationExitInfo.REASON_CRASH
                                || reason == ApplicationExitInfo.REASON_ANR;
                        if (!interesting) {
                            continue;
                        }
                        out.append("== Salida del proceso ==\n")
                                .append(String.format(
                                        Locale.US,
                                        "motivo=%s  pid=%d  fecha=%s%n",
                                        reasonName(reason),
                                        info.getPid(),
                                        new Date(info.getTimestamp())));

                        String logs = readOwnLogs(info.getPid());
                        if (!logs.isEmpty()) {
                            out.append("-- Registro del proceso (logcat) --\n")
                                    .append(logs)
                                    .append("\n");
                        }

                        try (InputStream stream = info.getTraceInputStream()) {
                            if (stream != null) {
                                String trace = readAll(stream);
                                if (!trace.isEmpty()) {
                                    String libs = librariesIn(trace);
                                    if (!libs.isEmpty()) {
                                        out.append("Bibliotecas en la traza: ").append(libs).append("\n");
                                    }
                                    out.append("-- Traza nativa --\n").append(trace).append("\n");
                                }
                            }
                        } catch (Throwable ignored) {
                            // sin traza disponible
                        }
                        out.append("\n");
                    }
                }
            } catch (Throwable ignored) {
                // API no disponible
            }
        }

        String report = out.toString().trim();
        if (newest > lastSeen) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putLong(KEY_LAST_SEEN, newest)
                    .apply();
        }
        return report.isEmpty() ? null : report;
    }

    /**
     * Guarda el informe en un archivo que se puede compartir: se encuentra en
     * {@code Android/data/com.coreia.app/files/coreia-diagnostico.txt}.
     */
    public static void saveReport(Context context, String report) {
        try {
            File dir = context.getExternalFilesDir(null);
            if (dir == null) {
                dir = context.getFilesDir();
            }
            if (dir == null) {
                return;
            }
            if (!dir.exists()) {
                dir.mkdirs();
            }
            try (FileOutputStream stream = new FileOutputStream(new File(dir, FILE_NAME))) {
                stream.write(report.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Throwable ignored) {
            // sin permiso de escritura: ignorar
        }
    }

    /** Borra el informe guardado. */
    public static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_JAVA)
                .apply();
    }

    /**
     * Lee el logcat del dispositivo y conserva solo las líneas del proceso
     * indicado (y las que contengan avisos fatales). La app solo puede ver sus
     * propios registros, así que esto es seguro.
     */
    private static String readOwnLogs(int pid) {
        Process process = null;
        StringBuilder out = new StringBuilder();
        try {
            process = new ProcessBuilder("logcat", "-d", "-v", "threadtime", "-t", "6000")
                    .redirectErrorStream(true)
                    .start();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                int kept = 0;
                String pidMarker = " " + pid + " ";
                while ((line = reader.readLine()) != null) {
                    boolean mine = pid > 0 && (line.contains(pidMarker) || line.contains(")" + pidMarker));
                    boolean fatal = line.contains("FATAL")
                            || line.contains("Check failed")
                            || line.contains("chromium")
                            || line.contains("libc :")
                            || line.contains("Native crash");
                    if (mine || fatal) {
                        out.append(line).append('\n');
                        kept++;
                        if (kept > 400) {
                            break;
                        }
                    }
                }
            }
        } catch (Throwable ignored) {
            // logcat no disponible
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
        return out.toString().trim();
    }

    /** Lista las bibliotecas nativas que aparecen en la traza. */
    private static String librariesIn(String trace) {
        LinkedHashSet<String> found = new LinkedHashSet<>();
        Matcher matcher = Pattern.compile("[A-Za-z0-9_.+-]+\\.so").matcher(trace);
        while (matcher.find()) {
            found.add(matcher.group());
            if (found.size() >= 40) {
                break;
            }
        }
        StringBuilder out = new StringBuilder();
        for (String library : found) {
            if (out.length() > 0) {
                out.append(", ");
            }
            out.append(library);
        }
        return out.toString();
    }

    private static String reasonName(int reason) {        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return String.valueOf(reason);
        }
        switch (reason) {
            case ApplicationExitInfo.REASON_CRASH:
                return "crash Java";
            case ApplicationExitInfo.REASON_CRASH_NATIVE:
                return "crash nativo";
            case ApplicationExitInfo.REASON_ANR:
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
        while ((read = stream.read(chunk)) != -1 && total < 400000) {
            buffer.write(chunk, 0, read);
            total += read;
        }
        return sanitize(buffer.toByteArray());
    }

    /**
     * Las trazas de caídas nativas llegan como protobuf binario. Aquí se
     * conservan solo los tramos de texto legible para poder mostrarlos.
     */
    private static String sanitize(byte[] data) {
        StringBuilder builder = new StringBuilder(data.length / 4);
        boolean pendingSpace = false;
        for (byte value : data) {
            char character = (char) (value & 0xFF);
            boolean printable = (character >= 32 && character < 127) || character == '\n' || character == '\t';
            if (printable) {
                if (pendingSpace) {
                    builder.append(' ');
                    pendingSpace = false;
                }
                builder.append(character);
            } else {
                pendingSpace = true;
            }
        }
        String text = builder.toString().trim();
        if (text.length() > MAX_TRACE_CHARS) {
            text = text.substring(0, MAX_TRACE_CHARS) + "\n[...recortado...]";
        }
        return text;
    }
}
