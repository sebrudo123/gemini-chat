package com.coreia.botpanel;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.os.Bundle;
import android.view.inputmethod.EditorInfo;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Login 100% nativo (sin WebView): Material, tema oscuro Core IA.
 *
 * Valida el correo y la contraseña contra el backend de Render. Si la
 * sesión es válida, entrega el token a MainActivity, que abre el panel
 * con #token=... para que el WebView lo guarde y entre directo. Con esto
 * la app arranca como una app real: pantalla propia, sin interfaz web.
 */
public class LoginActivity extends AppCompatActivity {

    public static final String EXTRA_TOKEN = "panel_token";
    public static final String EXTRA_TARGET = "panel_target";
    public static final String TARGET_WEBVIEW_LOGIN = "webview_login";
    private static final String PREFS = "coreia_prefs";
    private static final String KEY_TOKEN = "panel_token";
    private static final String KEY_EMAIL = "panel_email";

    /** Acceso del shell principal a la misma sesión (ajustes, cerrar sesión). */
    public static final String PREFS_NAME = PREFS;
    public static final String KEY_TOKEN_CACHE = KEY_TOKEN;
    public static final String KEY_EMAIL_CACHE = KEY_EMAIL;

    private TextInputEditText inputEmail;
    private TextInputEditText inputPass;
    private TextInputEditText inputTotp;
    private TextInputLayout totpField;
    private MaterialButton btnLogin;
    private TextView loginError;
    private TextView loginProgress;
    private String pendingToken = "";
    private boolean totpStage;
    private boolean working;

    /** URL del backend, derivada de la URL del panel (mismo host). */
    public static String apiBase() {
        final String panelUrl = BuildConfig.PANEL_URL;
        try {
            URL url = new URL(panelUrl);
            final String port = url.getPort() > 0 ? ":" + url.getPort() : "";
            return url.getProtocol() + "://" + url.getHost() + port;
        } catch (Exception err) {
            return "";
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        inputEmail = findViewById(R.id.inputEmail);
        inputPass = findViewById(R.id.inputPass);
        inputTotp = findViewById(R.id.inputTotp);
        totpField = findViewById(R.id.totpField);
        btnLogin = findViewById(R.id.btnLogin);
        MaterialButton btnDiscord = findViewById(R.id.btnDiscord);
        loginError = findViewById(R.id.loginError);
        loginProgress = findViewById(R.id.loginProgress);

        TextView version = findViewById(R.id.loginVersion);
        version.setText("v" + BuildConfig.VERSION_NAME + " · build "
                + BuildConfig.VERSION_CODE);

        inputPass.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                attemptLogin();
                return true;
            }
            return false;
        });
        inputTotp.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                attemptLogin();
                return true;
            }
            return false;
        });

        btnLogin.setOnClickListener(v -> attemptLogin());
        btnDiscord.setOnClickListener(v -> openWebviewLogin());

        inputEmail.setText(getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_EMAIL, ""));

        maybeResumeSavedSession();
    }

    /** Si hay token guardado todavía válido, entra directo sin login. */
    private void maybeResumeSavedSession() {
        final String saved = getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString(KEY_TOKEN, "");
        if (saved.isEmpty()) return;
        setBusy(true, "Comprobando sesión…");
        new Thread(() -> {
            final HttpResult res = httpJson("GET", apiBase() + "/api/admin/discord-bot",
                    null, saved);
            runOnUiThread(() -> {
                if (res.code == 200) openMain(saved);
                else {
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                            .remove(KEY_TOKEN).apply();
                    setBusy(false, null);
                }
            });
        }).start();
    }

    private void attemptLogin() {
        if (working) return;
        if (!totpStage) {
            final String email = inputEmail.getText() == null
                    ? "" : inputEmail.getText().toString().trim();
            final String pass = inputPass.getText() == null
                    ? "" : inputPass.getText().toString();
            if (email.isEmpty() || pass.isEmpty()) {
                showLoginError("Escribe tu correo y tu contraseña.");
                return;
            }
            setBusy(true, null);
            new Thread(() -> {
                final HttpResult res = httpJson("POST", apiBase() + "/api/auth/login",
                        jsonBody("email", email, "password", pass), null);
                runOnUiThread(() -> handleLoginResponse(res, email));
            }).start();
            return;
        }
        final String code = inputTotp.getText() == null
                ? "" : inputTotp.getText().toString().trim();
        if (code.isEmpty()) {
            showLoginError("Introduce el código de 2 pasos.");
            return;
        }
        setBusy(true, null);
        new Thread(() -> {
            final HttpResult res = httpJson("POST", apiBase() + "/api/auth/2fa/verify",
                    jsonBody("pending_token", pendingToken, "code", code), null);
            runOnUiThread(() -> handleLoginResponse(res,
                    inputEmail.getText() == null ? "" : inputEmail.getText().toString().trim()));
        }).start();
    }

    private void handleLoginResponse(final HttpResult res, final String email) {
        setBusy(false, null);
        if (res.code == -1) {
            showLoginError("Sin conexión con Core IA. Revisa tu internet e inténtalo de nuevo.");
            return;
        }
        final JSONObject data = parseJson(res.body);
        if (res.code == 200 && data != null && data.has("token")) {
            final String token = data.optString("token", "");
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putString(KEY_TOKEN, token)
                    .putString(KEY_EMAIL, email)
                    .apply();
            openMain(token);
            return;
        }
        if (data != null && data.optBoolean("requires_2fa", false)) {
            pendingToken = data.optString("pending_token", "");
            totpStage = true;
            totpField.setVisibility(android.view.View.VISIBLE);
            showLoginError(null);
            inputTotp.requestFocus();
            btnLogin.setText("Confirmar código");
            return;
        }
        if (res.code == 401) {
            showLoginError("Correo o contraseña incorrectos.");
        } else if (res.code == 429) {
            showLoginError("Demasiados intentos. Espera un momento y vuelve a probar.");
        } else if (res.code == 403) {
            showLoginError("Tu cuenta no tiene permisos de fundador para este panel.");
        } else {
            final String detail = data != null ? data.optString("detail", "") : "";
            showLoginError(detail.isEmpty()
                    ? "No se pudo iniciar sesión (código " + res.code + ")."
                    : detail);
        }
    }

    private void openMain(final String token) {
        final Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra(EXTRA_TOKEN, token);
        startActivity(intent);
        finish();
    }

    /** Login con Discord: el WebView del panel lo gestiona (OAuth real). */
    private void openWebviewLogin() {
        final Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra(EXTRA_TARGET, TARGET_WEBVIEW_LOGIN);
        startActivity(intent);
    }

    private static String jsonBody(String keyA, String valA, String keyB, String valB) {
        final JSONObject obj = new JSONObject();
        try {
            obj.put(keyA, valA);
            obj.put(keyB, valB);
        } catch (Exception ignored) {
            return "{}";
        }
        return obj.toString();
    }

    private static JSONObject parseJson(final String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception err) {
            return null;
        }
    }

    private void setBusy(final boolean busy, final String message) {
        working = busy;
        btnLogin.setEnabled(!busy);
        loginProgress.setVisibility(busy && message != null ? android.view.View.VISIBLE
                : android.view.View.GONE);
        if (busy && message != null) loginProgress.setText(message);
        if (!busy) return;
    }

    private void showLoginError(final String message) {
        if (message == null || message.isEmpty()) {
            loginError.setVisibility(android.view.View.GONE);
            return;
        }
        loginError.setText(message);
        loginError.setVisibility(android.view.View.VISIBLE);
    }

    static final class HttpResult {
        final int code;
        final String body;

        HttpResult(int code, String body) {
            this.code = code;
            this.body = body;
        }
    }

    /** Llamada JSON al backend (buferizada, con User-Agent propio). */
    @SuppressLint("DefaultLocale")
    static HttpResult httpJson(final String method, final String urlStr,
            final String bodyJson, final String bearer) {
        HttpURLConnection conn = null;
        try {
            final URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            // Render bloquea clientes sin User-Agent: siempre lo mandamos.
            conn.setRequestProperty("User-Agent", "CoreIABotPanel-Android/1.0");
            if (bearer != null && !bearer.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + bearer);
            }
            if (bodyJson != null) {
                conn.setDoOutput(true);
                final byte[] payload = bodyJson.getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload);
                }
            }
            final int code = conn.getResponseCode();
            final java.io.InputStream is = code >= 400
                    ? conn.getErrorStream() : conn.getInputStream();
            final StringBuilder sb = new StringBuilder();
            if (is != null) {
                final BufferedReader reader = new BufferedReader(
                        new InputStreamReader(is, StandardCharsets.UTF_8));
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                is.close();
            }
            return new HttpResult(code, sb.toString());
        } catch (Exception err) {
            return new HttpResult(-1, "");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
