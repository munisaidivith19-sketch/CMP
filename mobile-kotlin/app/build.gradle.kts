plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Push notifications need Firebase. Like the Expo app (GOOGLE_SERVICES_JSON), the
// plugin is applied only when a google-services.json is present, so the app
// builds and runs without it — pushes are simply disabled.
val hasGoogleServices = file("google-services.json").exists()
if (hasGoogleServices) apply(plugin = libs.plugins.google.services.get().pluginId)

/** -Pvexon.apiUrl=… > VEXON_API_URL > EXPO_PUBLIC_API_URL > gradle.properties. */
fun setting(prop: String, vararg envs: String): String =
    (providers.gradleProperty(prop).orNull?.takeIf { it.isNotBlank() }
        ?: envs.firstNotNullOfOrNull { System.getenv(it)?.takeIf(String::isNotBlank) }
        ?: "").trim().trimEnd('/').removeSuffix("/api")

val apiUrl = setting("vexon.apiUrl", "VEXON_API_URL", "EXPO_PUBLIC_API_URL")
val easProjectId = setting("vexon.easProjectId", "EAS_PROJECT_ID")
// Android blocks plain-HTTP traffic in release builds; allow it only when the
// configured backend (e.g. a campus LAN server) is not served over HTTPS.
val allowCleartext = apiUrl.isEmpty() || apiUrl.startsWith("http://")

/** Release signing secrets: -Pvexon.release.* (e.g. ~/.gradle/gradle.properties) > env var. Never in this repo. */
fun signingSetting(prop: String, env: String): String? =
    providers.gradleProperty(prop).orNull?.takeIf { it.isNotBlank() }
        ?: System.getenv(env)?.takeIf { it.isNotBlank() }

val releaseStoreFile = signingSetting("vexon.release.storeFile", "VEXON_RELEASE_STORE_FILE")
val releaseStorePassword = signingSetting("vexon.release.storePassword", "VEXON_RELEASE_STORE_PASSWORD")
val releaseKeyAlias = signingSetting("vexon.release.keyAlias", "VEXON_RELEASE_KEY_ALIAS")
val releaseKeyPassword = signingSetting("vexon.release.keyPassword", "VEXON_RELEASE_KEY_PASSWORD")
val missingReleaseSigning = listOf(
    "vexon.release.storeFile / VEXON_RELEASE_STORE_FILE" to releaseStoreFile,
    "vexon.release.storePassword / VEXON_RELEASE_STORE_PASSWORD" to releaseStorePassword,
    "vexon.release.keyAlias / VEXON_RELEASE_KEY_ALIAS" to releaseKeyAlias,
    "vexon.release.keyPassword / VEXON_RELEASE_KEY_PASSWORD" to releaseKeyPassword,
).filter { it.second == null }.map { it.first } +
    listOfNotNull(releaseStoreFile?.takeIf { !file(it).isFile }?.let { "keystore file not found: $it" })
val hasReleaseSigning = missingReleaseSigning.isEmpty()

android {
    namespace = "com.vexon.campus"
    compileSdk = 36

    defaultConfig {
        applicationId = (findProperty("ANDROID_PACKAGE") as String?) ?: "com.vexon.campus"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "API_URL", "\"$apiUrl\"")
        buildConfigField("String", "EAS_PROJECT_ID", "\"$easProjectId\"")
        buildConfigField("boolean", "PUSH_ENABLED", hasGoogleServices.toString())
        manifestPlaceholders["usesCleartextTraffic"] = allowCleartext.toString()
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            // Installs next to the Expo dev build (same package, different signing key).
            applicationIdSuffix = ".native"
            resValue("string", "app_name", "JNN (Kotlin)")
            // The emulator reaches the computer running `npm run dev` at 10.0.2.2.
            if (apiUrl.isEmpty()) buildConfigField("String", "API_URL", "\"http://10.0.2.2:5000\"")
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Release builds are signed with the real release key only — never
            // the debug key. Without one, checkReleaseSigning fails the build.
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
            // QA only: `-Pvexon.appIdSuffix=.qa` installs a minified build beside the store app.
            (findProperty("vexon.appIdSuffix") as String?)?.let { applicationIdSuffix = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/INDEX.LIST", "/META-INF/DEPENDENCIES")
    }
}

// A release build without the release keystore stops here with a clear message
// (debug builds never run this check).
val checkReleaseSigning by tasks.registering {
    val missing = missingReleaseSigning
    doLast {
        if (missing.isNotEmpty()) {
            throw GradleException(
                "Release signing is not configured, so no release build is produced " +
                    "(release builds never fall back to the debug key). Missing: " + missing.joinToString("; ") +
                    ". Set them as Gradle properties (e.g. in ~/.gradle/gradle.properties) or environment variables."
            )
        }
    }
}
tasks.matching { it.name.startsWith("pre") && it.name.endsWith("ReleaseBuild") }.configureEach { dependsOn(checkReleaseSigning) }

kotlin {
    jvmToolchain(17)
    compilerOptions {
        freeCompilerArgs.addAll(
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-opt-in=androidx.compose.foundation.layout.ExperimentalLayoutApi",
        )
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.core.splashscreen)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons.extended)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.socketio.client) {
        exclude(group = "org.json", module = "json") // provided by Android
    }
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)
    implementation(libs.mlkit.barcode)
    implementation(libs.play.location)
    implementation(libs.firebase.messaging)
    // Live bus map (vector tiles from the style URL the server configures).
    implementation(libs.maplibre.android)

    testImplementation(libs.junit)
}
