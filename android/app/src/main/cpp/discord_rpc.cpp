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
        return JNI_FALSE;
    }
    if (parsed == 0) {
        LOGW("Application ID vacío; RPC deshabilitado.");
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
        LOGI("Discord RPC inicializado (app=%llu)",
             static_cast<unsigned long long>(parsed));
        return JNI_TRUE;
    } catch (const std::exception& error) {
        LOGW("Excepción al inicializar el RPC: %s", error.what());
        return JNI_FALSE;
    } catch (...) {
        LOGW("Excepción desconocida al inicializar el RPC.");
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
            if (!result.Successful()) {
                LOGW("No se pudo actualizar la presencia en Discord.");
            }
        });
    } catch (const std::exception& error) {
        LOGW("Excepción al actualizar la presencia: %s", error.what());
    } catch (...) {
        LOGW("Excepción desconocida al actualizar la presencia.");
    }
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
    LOGI("Discord RPC detenido.");
}
