package com.coreia.app;

import android.annotation.SuppressLint;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.webkit.WebViewAssetLoader;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * Contenedor WebView de Core IA.
 *
 * Carga la web publicada; si no hay conexión, muestra la copia local
 * empaquetada en assets/www para que la app siempre abra.
 */
public class MainActivity extends AppCompatActivity {

    private static final String LIVE_URL = "https://sebrudo123.github.io/gemini-chat/";
    private static final String FALLBACK_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private boolean loadedFallback = false;
    private UpdateChecker updateChecker;
    private PermissionRequest pendingAudioRequest;

    private static final int REQUEST_MIC = 9002;

    private static WeakReference<WebView> webViewRef = new WeakReference<>(null);

    /** Avisa a la web de que la presencia se apagó desde la notificación. */
    public static void notifyPresenceStopped() {
        final WebView view = webViewRef.get();
        if (view == null) {
            return;
        }
        view.post(() -> {
            try {
                view.evaluateJavascript(
                        "window.coreiaPresence && window.coreiaPresence.onNativeStopped && window.coreiaPresence.onNativeStopped();",
                        null);
            } catch (Throwable ignored) {
                // sin web cargada: ignorar
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        Log.i("CoreIA", "onCreate: vista lista");

        CrashReporter.install(this);
        showLastCrashIfAny();

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = findViewById(R.id.webview);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " CoreIAApp/1.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                String host = request.getUrl().getHost();
                if (host != null && host.endsWith("androidplatform.net")) {
                    return false;
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return false;
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                Log.i("CoreIA", "onPageStarted " + url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.i("CoreIA", "onPageFinished " + url);
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error) {
                if (request.isForMainFrame() && !loadedFallback) {
                    loadedFallback = true;
                    Toast.makeText(MainActivity.this,
                            "Sin conexión: modo local", Toast.LENGTH_SHORT).show();
                    view.loadUrl(FALLBACK_URL);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                grantWebPermissions(request);
            }
        });
        webView.addJavascriptInterface(new DiscordBridge(), "DiscordRPC");
        webViewRef = new WeakReference<>(webView);

        if (savedInstanceState == null) {
            webView.loadUrl(LIVE_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        updateChecker = new UpdateChecker(this);
        updateChecker.checkForUpdate(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        DiscordRpc.shutdown();
        DiscordPresenceService.stop(this);
        webViewRef = new WeakReference<>(null);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /** Puente para que la web controle la presencia en Discord. */
    public class DiscordBridge {
        private boolean reportedPresenceCall = false;

        /** Inicializa el RPC con el Application ID de Discord. */
        @JavascriptInterface
        public boolean initRpc(String appId) {
            boolean ok = DiscordRpc.init(MainActivity.this, appId);
            if (ok) {
                requestNotificationPermission();
            }
            return ok;
        }

        /** Indica si el SDK de Discord está disponible en esta compilación. */
        @JavascriptInterface
        public boolean isAvailable() {
            return DiscordRpc.isAvailable();
        }

        /** Indica si la presencia se apagó por un cierre anterior. */
        @JavascriptInterface
        public boolean autoDisabled() {
            return DiscordRpc.isAutoDisabled();
        }

        /** Estado legible de la presencia (para Ajustes). */
        @JavascriptInterface
        public String getStatus() {
            return DiscordRpc.getStatus();
        }

        /** Actualiza los textos de la presencia. */
        @JavascriptInterface
        public void setPresence(String details, String state) {
            if (reportedPresenceCall) {
                return;
            }
            reportedPresenceCall = true;
            Log.i("CoreIA", "setPresence desde la web: " + details + " / " + state);
            DiscordRpc.update(details, state);
        }

        /** Detiene la presencia y su notificación. */
        @JavascriptInterface
        public void stopRpc() {
            DiscordRpc.shutdown();
            DiscordPresenceService.stop(MainActivity.this);
        }
    }

    private void showLastCrashIfAny() {
        // Leer el logcat y la traza puede tardar: nunca en el hilo principal.
        new Thread(() -> {
            final String report = CrashReporter.lastReport(this);
            if (report == null) {
                return;
            }
            CrashReporter.clear(this);
            CrashReporter.saveReport(this, report);
            // Evita que la presencia se active sola y vuelva a cerrar la app.
            DiscordRpc.markAutoDisabled();
            runOnUiThread(() -> showDiagnosticDialog(report));
        }, "coreia-diagnostico").start();
    }

    private void showDiagnosticDialog(String report) {
        if (isFinishing()) {
            return;
        }
        String message = report;
        if (message.length() > 12000) {
            message = message.substring(0, 12000) + "\n[...recortado...]";
        }
        new AlertDialog.Builder(this)
                .setTitle("Diagnóstico: la app se cerró")
                .setMessage(message)
                .setPositiveButton("Copiar", (dialog, which) -> {
                    ClipboardManager clipboard =
                            (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (clipboard != null) {
                        clipboard.setPrimaryClip(ClipData.newPlainText("Core IA diagnóstico", report));
                        Toast.makeText(this, "Diagnóstico copiado", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("Cerrar", null)
                .show();
    }

    /**
     * Concede a la web solo los permisos que la app tiene de verdad.
     *
     * Si la web pide el micrófono y la app aún no tiene el permiso del sistema,
     * se solicita y se responde a la petición cuando el usuario conteste.
     * Conceder el micrófono sin el permiso del sistema cierra WebView.
     */
    private void grantWebPermissions(final PermissionRequest request) {
        try {
            List<String> granted = new ArrayList<>();
            boolean needsMic = false;
            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                    if (hasPermission(android.Manifest.permission.RECORD_AUDIO)) {
                        granted.add(resource);
                    } else {
                        needsMic = true;
                    }
                } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                    // La app no usa cámara.
                } else {
                    granted.add(resource);
                }
            }
            if (needsMic) {
                pendingAudioRequest = request;
                ActivityCompat.requestPermissions(
                        this, new String[] {android.Manifest.permission.RECORD_AUDIO}, REQUEST_MIC);
            }
            if (!granted.isEmpty()) {
                request.grant(granted.toArray(new String[0]));
            } else if (!needsMic) {
                request.deny();
            }
        } catch (Throwable error) {
            Log.w("CoreIA", "onPermissionRequest falló: " + error);
        }
    }

    private boolean hasPermission(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_MIC) {
            return;
        }
        PermissionRequest pending = pendingAudioRequest;
        pendingAudioRequest = null;
        if (pending == null) {
            return;
        }
        try {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pending.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                pending.deny();
            }
        } catch (Throwable error) {
            Log.w("CoreIA", "respuesta al permiso de micrófono falló: " + error);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        runOnUiThread(() -> {
            if (!hasPermission(android.Manifest.permission.POST_NOTIFICATIONS)) {
                ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[] {android.Manifest.permission.POST_NOTIFICATIONS},
                        9001);
            }
        });
    }
}
