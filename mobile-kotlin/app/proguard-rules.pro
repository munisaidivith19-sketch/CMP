# kotlinx.serialization — the app parses JSON dynamically (JsonElement), but keep
# the runtime's generated serializers in case typed models are added later.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }

# socket.io-client / engine.io use reflection-free OkHttp; keep their public API.
-keep class io.socket.** { *; }
-dontwarn io.socket.**
-dontwarn org.json.**

# OkHttp / Okio platform probes.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
