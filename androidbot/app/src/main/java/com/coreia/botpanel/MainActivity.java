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

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import com.google.android.material.bottomnavigation.BottomNavigationView;

/**
 * Shell nativo del panel de Core IA Bot.
 *
 * El panel web vive en el WebView; la barra inferior de navegación es nativa
 * (BottomNavigationView, estilo app de chat) y se sincroniza en ambos
 * sentidos con el panel a través de los puentes JS. La app arranca con un
 * splash nativo (tema) y se oculta la barra nativa en la pantalla de login
 * y durante la pantalla de actualización.
 */
public class MainActivity extends AppCompatActivity {

    /** Destinos de la barra inferior (mismos nombres que switchView del panel). */
    private static final String[] TABS = {"resumen", "servidores", "mensajes", "extras", "anuncios"};
    private static final int[] TAB_IDS = {
        com.coreia.botpanel.R.id.nav_resumen,
        com.coreia.botpanel.R.id.nav_servidores,
        com.coreia.botpanel.R.id.nav_mensajes,
        com.coreia.botpanel.R.id.nav_extras,
        com.coreia.botpanel.R.id.nav_anuncios,
    };

    private static final int NAV_ACTIVE = 0xFF8F7BFF;
    private static final int NAV_IDLE = 0xFF7A7A92;

    private WebView webView;
    private BottomNavigationView bottomNav;
    private boolean loggedIn;
    private boolean overlayShown;
    /** Evita bucles: cuando Java marca la pestaña tras un aviso de JS. */
    private boolean suppressNavListener;

    /** Puente que usa el panel para comprobación e instalación de actualizaciones. */
    private class UpdateBridge {

        @JavascriptInterface
        public String getVersionCode() {
            return String.valueOf(com.coreia.botpanel.BuildConfig.VERSION_CODE);
        }

        @JavascriptInterface
        public String getVersionName() {
            return com.coreia.botpanel.BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public void installApk(String url) {
            downloadAndInstall(url);
        }
    }

    /** Puente del shell nativo: el panel avisa de login, pestaña y overlays. */
    private class NativeBridge {

        @JavascriptInterface
        public void onView(final String name) {
            runOnUiThread(() -> {
                if (suppressNavListener) return;
                selectTabQuietly(name);
            });
        }

        @JavascriptInterface
        public void onLoginState(final boolean logged) {
            runOnUiThread(() -> {
                loggedIn = logged;
                updateNavVisibility();
            });
        }

        @JavascriptInterface
        public void onOverlay(final boolean visible) {
            runOnUiThread(() -> {
                overlayShown = visible;
                updateNavVisibility();
            });
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        setContentView(com.coreia.botpanel.R.layout.activity_main);
        webView = findViewById(com.coreia.botpanel.R.id.webview);
        bottomNav = findViewById(com.coreia.botpanel.R.id.bottom_nav);

        final WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        // Nunca reutilizar el HTML viejo del caché: el panel vive en el backend
        // y debe reflejarse igual que en la web después de cada deploy.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setBackgroundColor(Color.parseColor("#15151f"));
        webView.setWebViewClient(new WebViewClient());

        webView.addJavascriptInterface(new UpdateBridge(), "CoreIAUpdate");
        webView.addJavascriptInterface(new NativeBridge(), "CoreIAAndroid");

        setupBottomNav();

        // Hasta que el panel confirme sesión, la barra nativa está oculta.
        loggedIn = false;
        overlayShown = false;
        updateNavVisibility();

        final String url = com.coreia.botpanel.BuildConfig.PANEL_URL;
        // La Activity de login nativa entrega el token validado, y esta
        // pantalla lo inyecta en el panel con #token=... (sesión directa).
        final String token = getIntent() != null
                ? getIntent().getStringExtra(LoginActivity.EXTRA_TOKEN) : null;
        final String target = getIntent() != null
                ? getIntent().getStringExtra(LoginActivity.EXTRA_TARGET) : null;
        if (savedInstanceState != null && !url.isEmpty()) {
            webView.restoreState(savedInstanceState);
        } else if (url.isEmpty()) {
            webView.loadData(
                "<h1 style='font-family:sans-serif;color:#8f7bff'>Core IA Bot</h1>"
                    + "<p style='font-family:sans-serif;color:#b4b4c8'>No hay URL de panel configurada.</p>",
                "text/html; charset=utf-8",
                "utf-8"
            );
        } else if (target != null
                && LoginActivity.TARGET_WEBVIEW_LOGIN.equals(target)) {
            // Ruta Discord: el panel web gestiona el OAuth dentro del WebView.
            webView.loadUrl(url);
        } else if (token != null && !token.isEmpty()) {
            // Sesión ya validada por el login nativo: entra directo.
            webView.loadUrl(url + "#token=" + token);
        } else {
            webView.loadUrl(url);
        }
    }

    /** Colores y listener de la barra inferior (estilo del panel, morado Core IA). */
    private void setupBottomNav() {
        final int[][] states = new int[][] {
            new int[] { android.R.attr.state_checked },
            new int[] { -android.R.attr.state_checked },
        };
        final int[] colors = new int[] { NAV_ACTIVE, NAV_IDLE };
        final android.content.res.ColorStateList tint = new android.content.res.ColorStateList(states, colors);
        bottomNav.setItemIconTintList(tint);
        bottomNav.setItemTextColor(tint);
        bottomNav.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF1B1B27));

        bottomNav.setOnItemSelectedListener(item -> {
            if (suppressNavListener) return true;
            final String tab = tabNameForItemId(item.getItemId());
            if (tab != null) {
                evaluateJs("window.CoreIAJS && CoreIAJS.switchView('" + tab + "');");
            }
            return true;
        });
    }

    private String tabNameForItemId(final int itemId) {
        for (int i = 0; i < TAB_IDS.length; i++) {
            if (TAB_IDS[i] == itemId) return TABS[i];
        }
        return null;
    }

    /** Selecciona la pestaña sin disparar de nuevo la llamada a JS. */
    private void selectTabQuietly(final String name) {
        for (int i = 0; i < TABS.length; i++) {
            if (TABS[i].equals(name)) {
                if (bottomNav.getSelectedItemId() != TAB_IDS[i]) {
                    suppressNavListener = true;
                    bottomNav.setSelectedItemId(TAB_IDS[i]);
                    suppressNavListener = false;
                }
                return;
            }
        }
    }

    /** La barra nativa solo se muestra con sesión iniciada y sin overlay de update. */
    private void updateNavVisibility() {
        final boolean show = loggedIn && !overlayShown;
        if (bottomNav != null) {
            bottomNav.setVisibility(show ? View.VISIBLE : View.GONE);
        }
    }

    private void evaluateJs(final String script) {
        if (webView == null) return;
        webView.evaluateJavascript(script, null);
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
        // En la app nativa, Atrás vuelve por el historial del panel si lo hay;
        // si no, cierra la app (comportamiento natural de una app).
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
