plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.system.optimizer"
    compileSdk = 34

    defaultConfig {
        // Keep the application ID so existing installs can receive a visible, safer upgrade.
        applicationId = "com.system.service.optimizer"
        minSdk = 30        // Android 11
        targetSdk = 34
        versionCode = 2
        versionName = "1.1.0"
    }

    buildFeatures { buildConfig = true }
    defaultConfig {
        fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
        buildConfigField("String", "AGENT_SERVER_URL", quoted(System.getenv("BHARATWATCH_SERVER_URL") ?: ""))
        buildConfigField("String", "AGENT_KEY", quoted(System.getenv("BHARATWATCH_AGENT_KEY") ?: ""))
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
}
