"""Pruebas de la verificación de correo y la autenticación en dos pasos (TOTP)."""

import pyotp
import pytest
from fastapi.testclient import TestClient

import main
from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _register(client, email: str, password: str = "supersecret") -> str:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": "Seguridad"},
    )
    assert response.status_code == 200
    return response.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _enable_twofa(client, token: str) -> list[str]:
    setup = client.post("/api/auth/2fa/setup", headers=_auth(token))
    assert setup.status_code == 200
    body = setup.json()
    assert body["secret"]
    assert body["otpauth_uri"].startswith("otpauth://totp/")

    code = pyotp.TOTP(body["secret"]).now()
    enable = client.post("/api/auth/2fa/enable", headers=_auth(token), json={"code": code})
    assert enable.status_code == 200
    assert enable.json()["enabled"] is True
    codes = enable.json()["recovery_codes"]
    assert len(codes) == 10
    return codes


def test_twofa_status_requires_auth(client):
    assert client.get("/api/auth/2fa/status").status_code == 401


def test_twofa_setup_enable_and_totp_login(client):
    email = "twofa-flow@example.com"
    token = _register(client, email)

    setup = client.post("/api/auth/2fa/setup", headers=_auth(token)).json()
    assert setup["secret"]
    assert setup["otpauth_uri"].startswith("otpauth://totp/")
    totp = pyotp.TOTP(setup["secret"])

    enable = client.post(
        "/api/auth/2fa/enable", headers=_auth(token), json={"code": totp.now()}
    )
    assert enable.status_code == 200
    assert len(enable.json()["recovery_codes"]) == 10

    status = client.get("/api/auth/2fa/status", headers=_auth(token)).json()
    assert status["enabled"] is True
    assert status["recovery_codes_remaining"] == 10

    login = client.post("/api/auth/login", json={"email": email, "password": "supersecret"})
    assert login.status_code == 200
    assert login.json().get("requires_2fa") is True
    assert "token" not in login.json()
    pending = login.json()["pending_token"]

    bad = client.post("/api/auth/2fa/verify", json={"pending_token": pending, "code": "000000"})
    assert bad.status_code == 400

    forged = client.post(
        "/api/auth/2fa/verify", json={"pending_token": "no-es-un-token", "code": "123456"}
    )
    assert forged.status_code == 401

    verify = client.post(
        "/api/auth/2fa/verify", json={"pending_token": pending, "code": totp.now()}
    )
    assert verify.status_code == 200
    assert verify.json()["token"]
    assert verify.json()["user"]["email"] == email


def test_twofa_recovery_code_consumed(client):
    email = "twofa-recovery@example.com"
    token = _register(client, email)
    codes = _enable_twofa(client, token)

    login = client.post("/api/auth/login", json={"email": email, "password": "supersecret"})
    pending = login.json()["pending_token"]

    verify = client.post(
        "/api/auth/2fa/verify", json={"pending_token": pending, "code": codes[0]}
    )
    assert verify.status_code == 200
    assert verify.json()["token"]

    status = client.get("/api/auth/2fa/status", headers=_auth(token)).json()
    assert status["recovery_codes_remaining"] == 9


def test_twofa_disable_with_password(client):
    email = "twofa-disable@example.com"
    token = _register(client, email)
    _enable_twofa(client, token)

    disabled = client.post(
        "/api/auth/2fa/disable",
        headers=_auth(token),
        json={"password": "supersecret"},
    )
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False

    login = client.post("/api/auth/login", json={"email": email, "password": "supersecret"})
    assert login.status_code == 200
    assert login.json().get("token")


def test_email_verification_flow(client):
    email = "verifica-correo@example.com"
    token = _register(client, email)
    profile = main.serializer.loads(token)["user"]
    assert profile["email_verified"] is False

    verify_token = main.email_serializer.dumps({"uid": profile["id"], "email": email})
    redirect = client.get(f"/api/auth/email/verify?token={verify_token}", follow_redirects=False)
    assert redirect.status_code in (302, 307)
    assert "email_verified=1" in redirect.headers["location"]

    me = client.get("/api/auth/me", headers=_auth(token)).json()["user"]
    assert me["email_verified"] is True


def test_email_verification_rejects_bad_token(client):
    redirect = client.get(
        "/api/auth/email/verify?token=invalido", follow_redirects=False
    )
    assert redirect.status_code in (302, 307)
    assert "email_verify_error=1" in redirect.headers["location"]


def test_parse_from():
    assert main._parse_from("Core IA <a@b.com>") == ("Core IA", "a@b.com")
    assert main._parse_from("a@b.com") == ("Core IA", "a@b.com")


def test_send_email_returns_false_without_transport(monkeypatch):
    monkeypatch.setattr(main.settings, "email_relay_url", "")
    monkeypatch.setattr(main.settings, "brevo_api_key", "")
    monkeypatch.setattr(main.settings, "smtp_host", "")
    monkeypatch.setattr(main.settings, "resend_api_key", "")
    assert main._send_email("dest@example.com", "Asunto", "<b>hola</b>") is False


def test_send_email_uses_relay_when_configured(monkeypatch):
    calls = {}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"ok": True}

    def fake_post(url, json=None, follow_redirects=None, timeout=None):
        calls["url"] = url
        calls["json"] = json
        calls["follow_redirects"] = follow_redirects
        return FakeResponse()

    monkeypatch.setattr(main.settings, "email_relay_url", "https://script.google.com/macros/s/x/exec")
    monkeypatch.setattr(main.settings, "email_relay_token", "secreto")
    monkeypatch.setattr(main.settings, "email_from", "Core IA <yo@gmail.com>")
    monkeypatch.setattr(main.httpx, "post", fake_post)

    assert main._send_email("dest@example.com", "Verifica", "<b>hola</b>") is True
    assert calls["url"] == "https://script.google.com/macros/s/x/exec"
    assert calls["json"]["token"] == "secreto"
    assert calls["json"]["to"] == "dest@example.com"
    assert calls["json"]["subject"] == "Verifica"
    assert calls["json"]["html"] == "<b>hola</b>"
    assert calls["json"]["replyTo"] == "yo@gmail.com"
    assert calls["follow_redirects"] is True


def test_send_email_relay_reports_failure(monkeypatch):
    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"ok": False}

    monkeypatch.setattr(main.settings, "email_relay_url", "https://script.google.com/macros/s/x/exec")
    monkeypatch.setattr(main.settings, "email_relay_token", "secreto")
    monkeypatch.setattr(main.settings, "brevo_api_key", "")
    monkeypatch.setattr(main.settings, "resend_api_key", "")
    monkeypatch.setattr(main.settings, "smtp_host", "")
    monkeypatch.setattr(main.httpx, "post", lambda *a, **k: FakeResponse())

    assert main._send_email("dest@example.com", "Asunto", "<b>hola</b>") is False


def test_send_email_uses_brevo_when_configured(monkeypatch):
    calls = {}

    class FakeResponse:
        status_code = 201

    def fake_post(url, headers=None, json=None, timeout=None):
        calls["url"] = url
        calls["headers"] = headers
        calls["json"] = json
        return FakeResponse()

    monkeypatch.setattr(main.settings, "email_relay_url", "")
    monkeypatch.setattr(main.settings, "brevo_api_key", "brevo-key")
    monkeypatch.setattr(main.settings, "email_from", "Core IA <yo@gmail.com>")
    monkeypatch.setattr(main.httpx, "post", fake_post)

    assert main._send_email("dest@example.com", "Verifica", "<b>hola</b>") is True
    assert calls["url"] == "https://api.brevo.com/v3/smtp/email"
    assert calls["headers"]["api-key"] == "brevo-key"
    assert calls["json"]["sender"] == {"name": "Core IA", "email": "yo@gmail.com"}
    assert calls["json"]["to"] == [{"email": "dest@example.com"}]
    assert calls["json"]["htmlContent"] == "<b>hola</b>"


def test_send_email_uses_smtp_when_configured(monkeypatch):
    import smtplib

    calls = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=20):
            calls["host"] = host
            calls["port"] = port

        def starttls(self):
            calls["tls"] = True

        def login(self, user, password):
            calls["login"] = (user, password)

        def send_message(self, message):
            calls["sent"] = message["Subject"]

        def quit(self):
            calls["quit"] = True

    monkeypatch.setattr(main.settings, "smtp_host", "smtp.gmail.com")
    monkeypatch.setattr(main.settings, "smtp_port", 587)
    monkeypatch.setattr(main.settings, "smtp_user", "yo@gmail.com")
    monkeypatch.setattr(main.settings, "smtp_password", "app-pass")
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)

    assert main._send_email("dest@example.com", "Verifica", "<b>hola</b>") is True
    assert calls["host"] == "smtp.gmail.com"
    assert calls["tls"] is True
    assert calls["login"] == ("yo@gmail.com", "app-pass")
    assert calls["sent"] == "Verifica"
    assert calls["quit"] is True
