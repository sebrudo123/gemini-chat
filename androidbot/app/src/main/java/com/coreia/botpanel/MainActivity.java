package com.coreia.botpanel;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.bottomsheet.BottomSheetDialog;

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
    private SwipeRefreshLayout swipe;
    private View dashHost;
    private boolean dashActive;
    private boolean loggedIn;
    private boolean overlayShown;
    /** Evita bucles: cuando Java marca la pestaña tras un aviso de JS. */
    private boolean suppressNavListener;
    private boolean networkConnected = true;

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
                showTab(name);
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

        /** La sesión del panel caducó: vuelve al login nativo (si fue la app
         * quien abrió este WebView) o no hace nada en el navegador externo. */
        @JavascriptInterface
        public void onAuthFailed() {
            runOnUiThread(() -> {
                final Intent launch = getIntent();
                final boolean fromLogin = launch != null
                        && (launch.hasExtra(LoginActivity.EXTRA_TOKEN)
                        || launch.hasExtra(LoginActivity.EXTRA_TARGET));
                if (fromLogin) {
                    android.widget.Toast.makeText(
                            MainActivity.this,
                            "La sesión ya no es válida. Entra de nuevo.",
                            android.widget.Toast.LENGTH_LONG
                    ).show();
                    finish();
                }
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
        swipe = findViewById(com.coreia.botpanel.R.id.swipe);
        dashHost = findViewById(com.coreia.botpanel.R.id.dashHost);
        if (dashHost != null) {
            LayoutInflater.from(this).inflate(
                com.coreia.botpanel.R.layout.view_resumen,
                (android.view.ViewGroup) dashHost, true);
        }

        final View gear = findViewById(com.coreia.botpanel.R.id.btnGear);
        if (gear != null) {
            gear.setOnClickListener(v -> showSettingsSheet());
        }
        setupSwipeRefresh();
        registerNetworkCallback();

        final WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        // Nunca reutilizar el HTML viejo del caché: el panel vive en el backend
        // y debe reflejarse igual que en la web después de cada deploy.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setBackgroundColor(Color.parseColor("#15151f"));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, final String url) {
                super.onPageFinished(view, url);
                // El recargado manual (pull) ya terminó: quita el indicador.
                if (swipe != null && swipe.isRefreshing()) {
                    swipe.setRefreshing(false);
                }
            }
        });

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
            showTab(tabNameForItemId(item.getItemId()));
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

    /**
     * Centraliza el cambio de vista. "Resumen" se pinta nativa (item 1: app
     * de verdad, sin WebView); el resto de pestañas vive en el panel web y
     * se les pide el cambio por el puente CoreIAJS.switchView.
     */
    private void showTab(final String tab) {
        if (tab == null || !loggedIn) return;
        selectTabQuietly(tab);
        if ("resumen".equals(tab)) {
            dashActive = true;
            if (dashHost != null) {
                dashHost.setVisibility(View.VISIBLE);
            }
            if (webView != null) {
                webView.setVisibility(View.GONE);
            }
            loadResumen();
        } else {
            dashActive = false;
            if (dashHost != null) {
                dashHost.setVisibility(View.GONE);
            }
            if (webView != null) {
                webView.setVisibility(View.VISIBLE);
            }
            evaluateJs("window.CoreIAJS && CoreIAJS.switchView('" + tab + "');");
        }
    }

    /** Carga los datos del Resumen nativo por el endpoint agregado. */
    private void loadResumen() {
        final String base = LoginActivity.apiBase();
        if (base.isEmpty()) return;
        final String token = getSharedPreferences(
            LoginActivity.PREFS_NAME, MODE_PRIVATE)
            .getString(LoginActivity.KEY_TOKEN_CACHE, "");
        ApiClient.get(base + "/api/admin/discord-bot/app-home", token,
            (code, body) -> runOnUiThread(() -> fillResumen(code, body)));
    }

    private void fillResumen(final int code, final String body) {
        if (swipe != null && swipe.isRefreshing()) {
            swipe.setRefreshing(false);
        }
        if (code != 200) return;
        try {
            final org.json.JSONObject data = new org.json.JSONObject(body);
            renderBotStatus(data.optJSONObject("bot"));
            renderGuilds(data.optJSONArray("guilds"));
            renderStats(data.optJSONObject("stats"));
            renderModlog(data.optJSONArray("modlog"));
            final TextView sync = findViewById(com.coreia.botpanel.R.id.lastSync);
            if (sync != null) {
                final String hora = new java.text.SimpleDateFormat(
                    "HH:mm", java.util.Locale.getDefault()).format(new java.util.Date());
                sync.setText("Actualizado a las " + hora);
            }
        } catch (Exception e) {
            // JSON incompleto: se conserva el render anterior sin caer.
        }
    }

    private void renderBotStatus(final org.json.JSONObject bot) {
        if (bot == null) return;
        final TextView name = findViewById(com.coreia.botpanel.R.id.botName);
        final TextView uptime = findViewById(com.coreia.botpanel.R.id.botUptime);
        final TextView state = findViewById(com.coreia.botpanel.R.id.botState);
        final View dotOk = findViewById(com.coreia.botpanel.R.id.botStateDot);
        final TextView error = findViewById(com.coreia.botpanel.R.id.botError);
        final boolean on = bot.optBoolean("running") && bot.optBoolean("ready");
        if (name != null) {
            name.setText(bot.optString("user", "Core IA"));
        }
        if (uptime != null) {
            final long started = parseIsoAsMillis(bot.optString("started_at", ""));
            if (started > 0) {
                final long mins = (System.currentTimeMillis() - started) / 60000L;
                uptime.setText(mins >= 60
                    ? "Activo " + (mins / 60) + " h"
                    : "Activo " + mins + " min");
            } else {
                uptime.setText("");
            }
        }
        if (state != null) {
            state.setText(on ? "En línea" : "Detenido");
            state.setTextColor(on ? 0xFF22C55E : 0xFFF87171);
        }
        if (dotOk != null) {
            dotOk.setBackgroundResource(on
                ? com.coreia.botpanel.R.drawable.bg_dot_ok
                : com.coreia.botpanel.R.drawable.bg_dot_bad);
        }
        if (error != null) {
            final String last = bot.optString("last_error", "");
            error.setVisibility(last.isEmpty() ? View.GONE : View.VISIBLE);
            if (!last.isEmpty()) error.setText(last);
        }
    }

    /** "2026-10-22T03:54:44.816398+00:00" → millis (0 si no se entiende). */
    private static long parseIsoAsMillis(final String iso) {
        try {
            final java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US);
            fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return fmt.parse(iso).getTime();
        } catch (Exception e) {
            return 0;
        }
    }

    private void renderStats(final org.json.JSONObject stats) {
        if (stats == null) return;
        setStatText(com.coreia.botpanel.R.id.statMessages,
            stats.optLong("messages_today", 0));
        setStatText(com.coreia.botpanel.R.id.statWelcomes,
            stats.optLong("welcomes", 0));
        setStatText(com.coreia.botpanel.R.id.statVerifs,
            stats.optLong("verifications", 0));
        setStatText(com.coreia.botpanel.R.id.statMods,
            stats.optLong("antiraid_triggers", 0)
                + stats.optLong("antiraid_blocked", 0)
                + stats.optLong("antispam_warn", 0)
                + stats.optLong("antispam_timeout", 0)
                + stats.optLong("antispam_kick", 0));
    }

    private void setStatText(final int id, final long value) {
        final TextView tv = findViewById(id);
        if (tv != null) tv.setText(String.valueOf(value));
    }

    private void renderGuilds(final org.json.JSONArray guilds) {
        final LinearLayout host = findViewById(com.coreia.botpanel.R.id.guildList);
        if (host == null) return;
        host.removeAllViews();
        if (guilds == null || guilds.length() == 0) {
            host.addView(makeEmptyRow("El bot aún no está en ningún servidor."));
            return;
        }
        for (int i = 0; i < guilds.length(); i++) {
            final org.json.JSONObject g = guilds.optJSONObject(i);
            if (g == null) continue;
            final LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            row.setPadding(28, 20, 28, 20);

            final TextView name = new TextView(this);
            name.setLayoutParams(new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            final String title = g.optString("name", "Servidor");
            name.setText(title.isEmpty() ? "Servidor" : title);
            name.setTextColor(0xFFDDDDDD);
            name.setTextSize(14f);
            name.setTypeface(name.getTypeface(), android.graphics.Typeface.BOLD);

            final TextView members = new TextView(this);
            members.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
            final long count = g.optLong("member_count", 0);
            members.setText(count > 0 ? membersLabel(count) : "");
            members.setTextColor(0xFF8F7BFF);
            members.setTextSize(12f);
            members.setTypeface(members.getTypeface(), android.graphics.Typeface.BOLD);

            row.addView(name);
            row.addView(members);
            host.addView(row);
        }
    }

    private static String membersLabel(final long n) {
        if (n >= 1000) return n / 1000 + "." + ((n % 1000) / 100) + "k";
        return String.valueOf(n);
    }

    private void renderModlog(final org.json.JSONArray events) {
        final LinearLayout host = findViewById(com.coreia.botpanel.R.id.modlogList);
        if (host == null) return;
        host.removeAllViews();
        if (events == null || events.length() == 0) {
            host.addView(makeEmptyRow("Sin eventos de moderación hoy."));
            return;
        }
        for (int i = 0; i < events.length() && i < 6; i++) {
            final org.json.JSONObject ev = events.optJSONObject(i);
            if (ev == null) continue;
            final String kind = modKindLabel(ev.optString("kind", ""));
            if (kind == null) continue;
            final LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(28, 20, 28, 20);

            final LinearLayout top = new LinearLayout(this);
            top.setOrientation(LinearLayout.HORIZONTAL);
            top.setGravity(android.view.Gravity.CENTER_VERTICAL);

            final TextView title = new TextView(this);
            title.setLayoutParams(new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            title.setText(kind);
            title.setTextColor(0xFFDDDDDD);
            title.setTextSize(13.5f);
            title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);

            final TextView when = new TextView(this);
            when.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
            when.setText(modTimeLabel(ev.optString("t", "")));
            when.setTextColor(0xFF5F5F78);
            when.setTextSize(11f);

            top.addView(title);
            top.addView(when);
            row.addView(top);

            final String detail = ev.optString("detail", "");
            if (!detail.isEmpty()) {
                final TextView sub = new TextView(this);
                sub.setLayoutParams(new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT));
                sub.setText(detail);
                sub.setTextColor(0xFF7A7A92);
                sub.setTextSize(12f);
                row.addView(sub);
            }
            host.addView(row);
        }
    }

    private TextView makeEmptyRow(final String text) {
        final TextView empty = new TextView(this);
        empty.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT));
        empty.setText(text);
        empty.setTextColor(0xFF5F5F78);
        empty.setTextSize(12.5f);
        empty.setPadding(28, 26, 28, 26);
        return empty;
    }

    private static String modKindLabel(final String kind) {
        switch (kind) {
            case "antiraid_trigger": return "Anti-raid: oleada detectada";
            case "antiraid_block": return "Anti-raid: bloqueó oleada";
            case "antispam_warn": return "Anti-spam: aviso";
            case "antispam_timeout": return "Anti-spam: expulsión temporal";
            case "antispam_kick": return "Anti-spam: expulsión";
            case "ticket_close": return "Ticket cerrado";
            case "ticket_transcript": return "Ticket: transcripción";
            case "voice_temp_created": return "Sala temporal creada";
            case "voice_temp_closed": return "Sala temporal cerrada";
            default: return null;
        }
    }

    private static String modTimeLabel(final String iso) {
        try {
            final java.text.SimpleDateFormat read = new java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US);
            read.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            final java.text.SimpleDateFormat out = new java.text.SimpleDateFormat(
                "d MMM · HH:mm", new java.util.Locale("es"));
            return out.format(read.parse(iso));
        } catch (Exception e) {
            return "";
        }
    }

    /** La barra nativa solo se muestra con sesión iniciada y sin overlay de update. */
    private void updateNavVisibility() {
        final boolean show = loggedIn && !overlayShown;
        final View topbar = findViewById(com.coreia.botpanel.R.id.topbar);
        if (topbar != null) {
            topbar.setVisibility(show ? View.VISIBLE : View.GONE);
        }
        if (bottomNav != null) {
            bottomNav.setVisibility(show ? View.VISIBLE : View.GONE);
        }
        final TextView banner = findViewById(com.coreia.botpanel.R.id.netBanner);
        if (banner != null) {
            banner.setVisibility(show && !networkConnected ? View.VISIBLE : View.GONE);
        }
    }

    /** Pull-to-refresh del panel: resumen nativo cuando está visible. */
    private void setupSwipeRefresh() {
        if (swipe == null) return;
        swipe.setOnRefreshListener(() -> {
            if (!networkConnected) {
                if (swipe.isRefreshing()) swipe.setRefreshing(false);
                return;
            }
            if (dashActive) {
                loadResumen();
            } else if (webView != null) {
                webView.reload();
            }
        });
        swipe.setOnChildScrollUpCallback((parent, child) -> {
            if (dashActive) return false; // permitir pull del dashboard siempre
            return webView != null && webView.getScrollY() > 0;
        });
    }

    /** Banner nativo de conexidad (ConnectivityManager, sin permisos raros). */
    private void registerNetworkCallback() {
        try {
            final ConnectivityManager cm = (ConnectivityManager)
                getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;
            final ConnectivityManager.NetworkCallback cb = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(final Network network) {
                    networkConnected = true;
                    runOnUiThread(() -> {
                        final TextView banner = findViewById(com.coreia.botpanel.R.id.netBanner);
                        if (banner != null) banner.setVisibility(View.GONE);
                    });
                }

                @Override
                public void onLost(final Network network) {
                    networkConnected = isConnectedNow(cm);
                    runOnUiThread(() -> {
                        final boolean down = !networkConnected;
                        if (down) {
                            Toast.makeText(MainActivity.this,
                                "Sin conexión a internet", Toast.LENGTH_SHORT).show();
                        }
                        updateNavVisibility();
                    });
                }
            };
            final android.net.NetworkRequest req = new android.net.NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build();
            cm.registerNetworkCallback(req, cb);
            networkConnected = isConnectedNow(cm);
        } catch (Exception e) {
            // Sin el aviso la app sigue funcionando igual.
        }
    }

    private boolean isConnectedNow(final ConnectivityManager cm) {
        final Network n = cm != null
            ? cm.getActiveNetwork() : null;
        if (n == null) return false;
        final NetworkCapabilities caps = cm.getNetworkCapabilities(n);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /** Hoja nativa de Ajustes: sesión, versión, updates y cerrar sesión. */
    private void showSettingsSheet() {
        final BottomSheetDialog sheet = new BottomSheetDialog(this);
        sheet.setContentView(
            LayoutInflater.from(this).inflate(
                com.coreia.botpanel.R.layout.settings_sheet, null, false));

        final TextView email = sheet.findViewById(com.coreia.botpanel.R.id.settingsEmail);
        final TextView version = sheet.findViewById(com.coreia.botpanel.R.id.settingsVersion);
        final View check = sheet.findViewById(com.coreia.botpanel.R.id.btnCheckUpdate);
        final View logoutBtn = sheet.findViewById(com.coreia.botpanel.R.id.btnLogoutApp);

        if (email != null) {
            final String saved = getSharedPreferences(LoginActivity.PREFS_NAME, MODE_PRIVATE)
                .getString(LoginActivity.KEY_EMAIL_CACHE, "");
            email.setText(saved == null || saved.isEmpty()
                ? "Sesión activa de Core IA" : "Sesión: " + saved);
        }
        if (version != null) {
            version.setText("Versión " + com.coreia.botpanel.BuildConfig.VERSION_NAME
                + " (" + com.coreia.botpanel.BuildConfig.VERSION_CODE + ")");
        }
        if (check != null) {
            check.setOnClickListener(v -> {
                sheet.dismiss();
                checkForUpdate(true);
            });
        }
        if (logoutBtn != null) {
            logoutBtn.setOnClickListener(v -> {
                sheet.dismiss();
                logoutFromApp();
            });
        }
        sheet.show();
    }

    /** Busca la última release y, si es más nueva, ofrece instalarla. */
    private void checkForUpdate(final boolean manual) {
        Toast.makeText(this, "Buscando actualizaciones…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            String apkUrl = "";
            long latestCode = -1;
            try {
                final HttpURLConnection conn = (HttpURLConnection) new URL(
                    "https://api.github.com/repos/sebrudo123/gemini-chat/releases/latest")
                    .openConnection();
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("Accept", "application/vnd.github+json");
                conn.setRequestProperty("User-Agent", "CoreIABotPanel-Android/1.0");
                if (conn.getResponseCode() == 200) {
                    final StringBuilder buf = new StringBuilder();
                    final InputStream in = new BufferedInputStream(conn.getInputStream());
                    final byte[] chunk = new byte[4096];
                    int n;
                    while ((n = in.read(chunk)) != -1) buf.append(new String(chunk, 0, n));
                    in.close();
                    final org.json.JSONObject rel = new org.json.JSONObject(buf.toString());
                    latestCode = parseTagVersion(rel.optString("tag_name", ""));
                    final org.json.JSONArray assets = rel.optJSONArray("assets");
                    if (assets != null) {
                        for (int i = 0; i < assets.length(); i++) {
                            final org.json.JSONObject a = assets.getJSONObject(i);
                            if ("coreia-bot.apk".equals(a.optString("name", ""))) {
                                apkUrl = a.optString("browser_download_url", "");
                                break;
                            }
                        }
                    }
                }
            } catch (Exception e) {
                apkUrl = "";
            }
            final String url = apkUrl;
            final long code = latestCode;
            runOnUiThread(() -> {
                if (code >= 0 && code > com.coreia.botpanel.BuildConfig.VERSION_CODE
                        && !url.isEmpty()) {
                    Toast.makeText(this, "Descargando la nueva versión…",
                        Toast.LENGTH_LONG).show();
                    downloadAndInstall(url);
                } else if (manual) {
                    Toast.makeText(this, code < 0
                        ? "No se pudo comprobar. Revisa tu internet."
                        : "Ya tienes la última versión (" + com.coreia.botpanel.BuildConfig.VERSION_NAME + ")",
                        Toast.LENGTH_LONG).show();
                }
            });
        }).start();
    }

    /** "bot-v1.0.25" → 25; sin match funciona de señal desconocida (-1). */
    private static long parseTagVersion(final String tag) {
        try {
            return Long.parseLong(tag.replaceAll(".*v", "").trim());
        } catch (Exception e) {
            return -1;
        }
    }

    /** Cerrar sesión desde Ajustes: borra credenciales nativas y de sesión. */
    private void logoutFromApp() {
        try {
            getSharedPreferences(LoginActivity.PREFS_NAME, MODE_PRIVATE).edit()
                .remove(LoginActivity.KEY_TOKEN_CACHE).apply();
            if (webView != null) {
                webView.evaluateJavascript(
                    "try{localStorage.clear();sessionStorage.clear();}catch(e){}", null);
                webView.clearCache(true);
            }
            final CookieManager cookies = CookieManager.getInstance();
            cookies.removeAllCookies(null);
            cookies.flush();
        } catch (Exception e) {
            // Lo importante es borrar el token nativo.
        }
        Toast.makeText(this, "Sesión cerrada", Toast.LENGTH_SHORT).show();
        final Intent login = new Intent(this, LoginActivity.class);
        login.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(login);
        finish();
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
