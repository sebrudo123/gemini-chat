package com.coreia.botpanel;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** WebView del panel web de Core IA Bot servido por el backend en /bot. */
public class MainActivity extends AppCompatActivity {

    private WebView webView;

    /** Puente que usa el panel para comprobación e instalación de actualizaciones. */
    private class UpdateBridge {

        @JavascriptInterface
        public String getVersionCode() {
            return String.valueOf(BuildConfig.VERSION_CODE);
        }

        @JavascriptInterface
        public String getVersionName() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public void installApk(String url) {
            downloadAndInstall(url);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        String url = com.coreia.botpanel.BuildConfig.PANEL_URL;

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        // Nunca reutilizar el HTML viejo del caché: el panel vive en el backend
        // y debe reflejarse igual que en la web después de cada deploy.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setBackgroundColor(Color.parseColor("#171722"));
        webView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new UpdateBridge(), "CoreIAUpdate");
        // Aceleración por hardware (por defecto). El modo SOFTWARE causaba
        // problemas de scroll/renderizado del panel en algunos WebViews.

        if (savedInstanceState != null && !url.isEmpty()) {
            webView.restoreState(savedInstanceState);
        }
        if (!url.isEmpty()) {
            webView.loadUrl(url);
        } else {
            webView.loadData(
                "<h1 style='font-family:sans-serif;color:#8f7bff'>Core IA Bot</h1>"
                    + "<p style='font-family:sans-serif;color:#b4b4c8'>No hay URL de panel configurada.</p>",
                "text/html; charset=utf-8",
                "utf-8"
            );
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    /** Descarga el APK con progreso hacia JS y al terminar abre el instalador. */
    private void downloadAndInstall(String url) {
        new Thread(() -> {
            File target = new File(getCacheDir(), "coreia-bot-update.apk");
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(60000);
                connection.setInstanceFollowRedirects(true);
                connection.connect();

                long total = connection.getContentLengthLong();
                InputStream input = new BufferedInputStream(connection.getInputStream());
                FileOutputStream output = new FileOutputStream(target);
                byte[] buffer = new byte[16384];
                long written = 0;
                int read;
                int lastPercent = -1;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    written += read;
                    if (total > 0) {
                        int percent = (int) (written * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            notifyProgress(percent);
                        }
                    }
                }
                output.flush();
                output.close();
                input.close();
                openInstaller(target);
            } catch (Exception e) {
                notifyJavaScript("onError", "No se pudo descargar la actualización. Conéctate a internet e inténtalo de nuevo.");
            } finally {
                //noinspection ResultOfMethodCallIgnored
                target.deleteOnExit();
            }
        }).start();
    }

    /** Abre el instalador de paquetes de Android con el APK descargado. */
    private void openInstaller(File apk) {
        Uri apkUri = FileProvider.getUriForFile(
            this, "com.coreia.botpanel.fileprovider", apk);
        notifyJavaScript("onInstalling", null);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
        } catch (Exception e) {
            notifyJavaScript("onError", "No se pudo abrir el instalador de Android.");
        }
    }

    private void notifyProgress(final int percent) {
        notifyJavaScript("onDownload", String.valueOf(percent));
    }

    private void notifyJavaScript(final String callback, final String argument) {
        final StringBuilder js = new StringBuilder();
        js.append("window.CoreIAUI && window.CoreIAUI.").append(callback).append("(");
        if (argument != null) {
            js.append('"').append(argument.replace("\"", "\\\"")).append('"');
        }
        js.append(")");
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(js.toString(), null);
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            finish();
        }
    }
}
