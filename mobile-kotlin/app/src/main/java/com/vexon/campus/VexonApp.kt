package com.vexon.campus

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.vexon.campus.core.Auth
import com.vexon.campus.core.Http
import com.vexon.campus.core.QueryClient
import com.vexon.campus.core.Realtime
import com.vexon.campus.core.SecureStore

class VexonApp : Application(), SingletonImageLoader.Factory {
    override fun onCreate() {
        super.onCreate()
        instance = this
        SecureStore.init(this)

        // RTK Query's refetchOnFocus: on Android the app "focuses" when it returns to
        // the foreground — reconnect the socket and refetch what is on screen.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            private var started = false
            override fun onStart(owner: LifecycleOwner) {
                if (started && Auth.user != null) {
                    Realtime.onForeground()
                    QueryClient.refetchActive()
                }
                started = true
            }
        })
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { Http.client })) }
            .build()

    companion object {
        lateinit var instance: VexonApp
            private set
    }
}
