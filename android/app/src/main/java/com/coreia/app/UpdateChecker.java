package com.coreia.app;

import android.app.Activity;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.AsyncTask;
import android.os.Build;
import android.os.Environment;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Comprueba si hay una nueva versión publicada en GitHub Releases.
 *
 * Descarga el APK dentro de la app y abre el instalador nativo de Android.
 * Si la actualización se considera obligatoria, no permite continuar sin
 * instalarla.
 */
public class UpdateChecker {

    private static final String REPO = "sebrudo123/gemini-chat";
    private static final String API_URL = "https://api.github.com/repos/" + REPO + "/releases/latest";

    private final Activity activity;
    private boolean forceUpdate = false;
    private String tagName = "";
    private String apkUrl = "";

    public UpdateChecker(Activity activity) {
        this.activity = activity;
    }

    public void checkForUpdate(boolean forced) {
        this.forceUpdate = forced;
        new CheckTask().execute();
    }

    private int currentVersionCode() {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) info.getLongVersionCode();
            }
            return info.versionCode;
        } catch (Exception e) {
            return 1;
        }
    }

    private static int parseVersionCode(String version, int fallback) {
        try {
            String[] parts = version.split("\\.");
            if (parts.length >= 3) {
                return Integer.parseInt(parts[2]);
            }
        } catch (Exception ignored) {
        }
        return fallback;
    }

    private class CheckTask extends AsyncTask<Void, Void, Boolean> {

        @Override
        protected Boolean doInBackground(Void... voids) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(API_URL);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestProperty("Accept", "application/vnd.github+json");
                conn.setRequestProperty("User-Agent", "CoreIA-Android-App");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);

                if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
                    return false;
                }

                StringBuilder sb = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
                    }
                }

                JSONObject json = new JSONObject(sb.toString());
                tagName = json.optString("tag_name", "");
                JSONArray assets = json.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.getJSONObject(i);
                        if (asset.optString("name", "").endsWith(".apk")) {
                            apkUrl = asset.optString("browser_download_url", "");
                            break;
                        }
                    }
                }

                String version = tagName.replaceFirst("^v", "");
                int latestCode = parseVersionCode(version, currentVersionCode());
                return latestCode > currentVersionCode() && !apkUrl.isEmpty();
            } catch (Exception e) {
                return false;
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }

        @Override
        protected void onPostExecute(Boolean needUpdate) {
            if (needUpdate) {
                showUpdateDialog();
            } else if (forceUpdate) {
                Toast.makeText(activity, "No hay actualizaciones disponibles", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void showUpdateDialog() {
        new AlertDialog.Builder(activity)
                .setTitle("Nueva versión disponible")
                .setMessage("Hay una actualización disponible (" + tagName
                        + "). ¿Quieres instalarla ahora?")
                .setCancelable(!forceUpdate)
                .setPositiveButton("Actualizar ahora", (dialog, which) -> downloadAndInstall())
                .setNegativeButton(forceUpdate ? "Salir" : "Más tarde", (dialog, which) -> {
                    if (forceUpdate) {
                        activity.finish();
                    }
                })
                .show();
    }

    private void downloadAndInstall() {
        new DownloadTask().execute(apkUrl);
    }

    private class DownloadTask extends AsyncTask<String, Integer, File> {

        private ProgressDialog progress;

        @Override
        protected void onPreExecute() {
            progress = new ProgressDialog(activity);
            progress.setMessage("Descargando actualización...");
            progress.setIndeterminate(false);
            progress.setMax(100);
            progress.setCancelable(false);
            progress.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
            progress.show();
        }

        @Override
        protected File doInBackground(String... urls) {
            HttpURLConnection conn = null;
            try {
                File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir != null && !dir.exists()) {
                    dir.mkdirs();
                }
                File file = new File(dir, "CoreIA-update.apk");

                URL url = new URL(urls[0]);
                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.connect();

                int length = conn.getContentLength();
                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     OutputStream out = new FileOutputStream(file)) {
                    byte[] data = new byte[8192];
                    long total = 0;
                    int count;
                    while ((count = in.read(data)) != -1) {
                        total += count;
                        if (length > 0) {
                            publishProgress((int) (total * 100 / length));
                        }
                        out.write(data, 0, count);
                    }
                    out.flush();
                }
                return file;
            } catch (Exception e) {
                return null;
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }

        @Override
        protected void onProgressUpdate(Integer... values) {
            progress.setProgress(values[0]);
        }

        @Override
        protected void onPostExecute(File file) {
            progress.dismiss();
            if (file == null) {
                Toast.makeText(activity, "Error al descargar la actualización", Toast.LENGTH_SHORT).show();
                if (forceUpdate) {
                    activity.finish();
                }
                return;
            }
            installApk(file);
        }
    }

    private void installApk(File file) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            requestInstallPermission();
            return;
        }
        launchInstaller(file);
    }

    private void requestInstallPermission() {
        new AlertDialog.Builder(activity)
                .setTitle("Permiso necesario")
                .setMessage("Para instalar la actualización debes permitir instalar aplicaciones "
                        + "desconocidas desde esta fuente.")
                .setCancelable(false)
                .setPositiveButton("Abrir ajustes", (dialog, which) -> {
                    Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    intent.setData(Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(intent);
                })
                .setNegativeButton("Salir", (dialog, which) -> activity.finish())
                .show();
    }

    private void launchInstaller(File file) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        Uri uri;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".provider", file);
            intent.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } else {
            uri = Uri.fromFile(file);
        }
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(intent);
        if (forceUpdate) {
            activity.finish();
        }
    }
}
