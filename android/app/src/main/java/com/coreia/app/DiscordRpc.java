package com.coreia.app;

import android.content.Context;
import android.util.Log;

import java.lang.reflect.Method;

public class DiscordRpc {
    private static final String TAG = "DiscordRpc";
    private static boolean initialized = false;

    public static void init(Context context) {
        try {
            Class<?> cls = Class.forName("com.discord.rpc.DiscordRPC");
            Method m = cls.getMethod("initialize", Context.class, String.class);
            m.invoke(null, context.getApplicationContext(), "1400000000000000000");
            initialized = true;
        } catch (Exception e) {
            Log.w(TAG, "Discord RPC init failed: " + e.toString());
            initialized = false;
        }
    }

    public static void update(String details, String state) {
        if (!initialized) return;
        try {
            Class<?> cls = Class.forName("com.discord.rpc.DiscordRPC");
            Method m = cls.getMethod("updatePresence", String.class, String.class, String.class);
            m.invoke(null, details, state, null);
        } catch (Exception e) {
            Log.w(TAG, "Discord RPC update failed: " + e.toString());
        }
    }

    public static void shutdown() {
        if (!initialized) return;
        try {
            Class<?> cls = Class.forName("com.discord.rpc.DiscordRPC");
            Method m = cls.getMethod("shutdown");
            m.invoke(null);
            initialized = false;
        } catch (Exception e) {
            Log.w(TAG, "Discord RPC shutdown failed: " + e.toString());
        }
    }
}
