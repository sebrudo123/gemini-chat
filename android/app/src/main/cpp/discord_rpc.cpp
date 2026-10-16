//
// Puente JNI para Discord Rich Presence usando el SDK oficial (discordpp).
//
// La capa Java del SDK no expone la presencia, así que aquí usamos la API C++
// (discordpp::Client / discordpp::Activity). Si algo falla, se registra en
// logcat y la app sigue funcionando con normalidad.
//
#include <jni.h>

#include <android/log.h>

#include <memory>
#include <mutex>
#include <string>

// Las clases C++ del SDK (discordpp::Client/Activity) se generan en el propio
// encabezado; hay que activar la implementación en una única unidad de
// compilación y enlazar contra la API C exportada por libdiscord_partner_sdk.so.
#define DISCORDPP_IMPLEMENTATION
#include "discordpp.h"

#define LOG_TAG "CoreIA.DiscordRpc"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

namespace {

std::mutex g_mutex;
std::unique_ptr<discordpp::Client> g_client;
uint64_t g_application_id = 0;

std::mutex g_status_mutex;
std::string g_status = "sin iniciar";

std::string to_utf8(JNIEnv* env, jstring value) {
    if (value == nullptr) {
        return std::string();
    }
    const char* chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) {
        return std::string();
    }
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}

void set_status(const std::string& status) {
    std::lock_guard<std::mutex> lock(g_status_mutex);
    g_status = status;
}

std::string get_status() {
    std::lock_guard<std::mutex> lock(g_status_mutex);
    return g_status;
}

}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_coreia_app_DiscordRpc_nativeInit(JNIEnv* env, jclass /* clazz */, jstring appId) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_client) {
        return JNI_TRUE;
    }

    const std::string raw = to_utf8(env, appId);
    uint64_t parsed = 0;
    try {
        parsed = std::stoull(raw);
    } catch (...) {
        LOGW("Application ID inválido: '%s'", raw.c_str());
        set_status("Application ID inválido");
        return JNI_FALSE;
    }
    if (parsed == 0) {
        LOGW("Application ID vacío; RPC deshabilitado.");
        set_status("falta el Application ID");
        return JNI_FALSE;
    }

    try {
        // Los callbacks del SDK se ejecutan directamente en el hilo que los
        // dispare (no hay bucle de mensajes propio que sincronizar).
        discordpp::SetSynchronizationContext([](std::function<void()> task) {
            if (task) {
                task();
            }
        });

        auto client = std::make_unique<discordpp::Client>();
        if (!*client) {
            LOGW("No se pudo crear discordpp::Client.");
            set_status("no se pudo crear el cliente del SDK");
            return JNI_FALSE;
        }
        client->SetApplicationId(parsed);
        client->SetStatusChangedCallback(
                [](discordpp::Client::Status status, discordpp::Client::Error error, int32_t detail) {
                    LOGI("Estado del cliente Discord: status=%d error=%d detalle=%d",
                         static_cast<int>(status), static_cast<int>(error), detail);
                });

        g_application_id = parsed;
        g_client = std::move(client);
        LOGI("Discord RPC inicializado (app=%llu)", static_cast<unsigned long long>(parsed));
        set_status("iniciado; comprobando la app de Discord…");

        // Diagnóstico: ¿está instalada la app de Discord?
        g_client->IsDiscordAppInstalled([](bool installed) {
            LOGI("¿App de Discord instalada? %s", installed ? "sí" : "no");
            if (!installed) {
                set_status("la app de Discord no está instalada");
            }
        });

        return JNI_TRUE;
    } catch (const std::exception& error) {
        LOGW("Excepción al inicializar el RPC: %s", error.what());
        set_status(std::string("error: ") + error.what());
        return JNI_FALSE;
    } catch (...) {
        LOGW("Excepción desconocida al inicializar el RPC.");
        set_status("error desconocido al iniciar");
        return JNI_FALSE;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_coreia_app_DiscordRpc_nativeUpdate(JNIEnv* env, jclass /* clazz */, jstring details,
                                            jstring state) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_client) {
        return;
    }

    try {
        const std::string detail_text = to_utf8(env, details);
        const std::string state_text = to_utf8(env, state);

        discordpp::Activity activity;
        activity.SetType(discordpp::ActivityTypes::Playing);
        if (!detail_text.empty()) {
            activity.SetDetails(detail_text);
        }
        if (!state_text.empty()) {
            activity.SetState(state_text);
        }

        g_client->UpdateRichPresence(std::move(activity), [](discordpp::ClientResult result) {
            if (result.Successful()) {
                set_status("mostrando en Discord");
            } else {
                LOGW("No se pudo actualizar la presencia en Discord.");
                set_status("no se pudo mostrar en Discord");
            }
        });
    } catch (const std::exception& error) {
        LOGW("Excepción al actualizar la presencia: %s", error.what());
        set_status(std::string("error: ") + error.what());
    } catch (...) {
        LOGW("Excepción desconocida al actualizar la presencia.");
        set_status("error desconocido al actualizar");
    }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_coreia_app_DiscordRpc_nativeStatus(JNIEnv* env, jclass /* clazz */) {
    const std::string status = get_status();
    return env->NewStringUTF(status.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_coreia_app_DiscordRpc_nativeRunCallbacks(JNIEnv* /* env */, jclass /* clazz */) {
    discordpp::RunCallbacks();
}

extern "C" JNIEXPORT void JNICALL
Java_com_coreia_app_DiscordRpc_nativeShutdown(JNIEnv* /* env */, jclass /* clazz */) {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_client.reset();
    g_application_id = 0;
    set_status("desactivado");
    LOGI("Discord RPC detenido.");
}
