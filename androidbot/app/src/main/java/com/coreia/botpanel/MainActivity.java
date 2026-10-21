package com.coreia.botpanel;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

/** WebView del panel web de Core IA Bot servido por el backend en /bot. */
public class MainActivity extends AppCompatActivity {

    private WebView webView;

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
