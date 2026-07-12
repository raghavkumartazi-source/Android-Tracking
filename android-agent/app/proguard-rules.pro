# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# Keep our service and receivers
-keep class com.system.optimizer.service.** { *; }
-keep class com.system.optimizer.admin.** { *; }
