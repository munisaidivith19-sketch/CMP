package com.vexon.campus.nav

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.net.URLDecoder

/** A parsed app link: "/gate-pass/123?tab=review" → segments [gate-pass, 123], query {tab=review}. */
data class Route(val link: String) {
    val path: String
    val segments: List<String>
    val query: Map<String, String>

    init {
        val noFragment = link.substringBefore('#')
        val rawPath = noFragment.substringBefore('?')
        path = ("/" + rawPath.trim('/')).let { if (it == "/") it else it.trimEnd('/') }
        segments = path.split('/').filter { it.isNotEmpty() }.map(::decode)
        query = noFragment.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.associate { pair ->
            decode(pair.substringBefore('=')) to decode(pair.substringAfter('=', ""))
        }
    }

    private companion object {
        fun decode(s: String): String = runCatching { URLDecoder.decode(s, "UTF-8") }.getOrDefault(s)
    }

    fun seg(i: Int): String? = segments.getOrNull(i)
    fun q(name: String): String? = query[name]?.takeIf { it.isNotEmpty() }
}

/**
 * Path-based navigation mirroring expo-router, so links from the server's
 * notifications ("/gate-pass/123", "/alumni?tab=jobs") open the same screens
 * as on the web. The bottom tabs live at "/", "/chat", "/campus",
 * "/notifications" and "/profile".
 */
object Nav {
    class Entry(val id: Long, val route: Route)

    val TABS = listOf("index", "chat", "campus", "notifications", "profile")
    private val TAB_PATHS = mapOf("/" to "index", "/chat" to "chat", "/campus" to "campus", "/notifications" to "notifications", "/profile" to "profile")

    private var nextId = 0L
    val stack = mutableStateListOf<Entry>()
    var tab by mutableStateOf("index")

    private fun entry(link: String) = Entry(nextId++, Route(link))

    /** Signed-in root: the tab bar. */
    fun resetSignedIn(tabName: String = "index") {
        stack.clear()
        stack += entry("/")
        tab = tabName
    }

    fun resetSignedOut() {
        stack.clear()
        stack += entry("/login")
    }

    fun push(link: String) {
        val route = Route(link)
        val tabName = TAB_PATHS[route.path]
        if (tabName != null && stack.firstOrNull()?.route?.path == "/") {
            // A tab link switches tabs, like expo-router's Tabs navigator.
            while (stack.size > 1) stack.removeAt(stack.lastIndex)
            tab = tabName
            return
        }
        // Tapping the same screen twice (double tap) must not stack duplicates.
        if (stack.lastOrNull()?.route?.link == link) return
        stack += entry(link)
    }

    fun replace(link: String) {
        val route = Route(link)
        val tabName = TAB_PATHS[route.path]
        if (tabName != null && stack.firstOrNull()?.route?.path == "/") {
            while (stack.size > 1) stack.removeAt(stack.lastIndex)
            tab = tabName
            return
        }
        if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex)
        stack += entry(link)
    }

    val canGoBack: Boolean get() = stack.size > 1

    /** Back button: pop, or from another tab return to Home (react-navigation's "firstRoute"). */
    fun back(): Boolean {
        if (stack.size > 1) {
            stack.removeAt(stack.lastIndex)
            return true
        }
        if (stack.firstOrNull()?.route?.path == "/" && tab != "index") {
            tab = "index"
            return true
        }
        if (stack.firstOrNull()?.route?.path == "/forgot-password") {
            resetSignedOut()
            return true
        }
        return false
    }
}
