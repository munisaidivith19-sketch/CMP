package com.vexon.campus.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import com.vexon.campus.ui.Dialogs
import kotlinx.serialization.json.JsonElement
import java.util.concurrent.ConcurrentHashMap

/** Snapshot of one cached request — same fields the screens used from RTK Query hooks. */
data class QueryResult(
    val data: JsonElement? = null,
    val error: Throwable? = null,
    val isFetching: Boolean = false,
    val hasFetched: Boolean = false,
) {
    /** First load: no data yet and a request in flight (RTK `isLoading`). */
    val isLoading get() = data == null && error == null && (isFetching || !hasFetched)
}

/**
 * A tiny RTK Query: responses are cached by key, tagged, and refetched when a
 * mutation or a live socket event invalidates one of their tags, when the app
 * returns to the foreground, and when the server becomes reachable again.
 */
object QueryClient {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val entries = ConcurrentHashMap<String, Entry>()

    class Entry(val key: String) {
        val state = MutableStateFlow(QueryResult())
        var tags: Set<String> = emptySet()
        var fetcher: (suspend () -> JsonElement)? = null
        var subscribers = 0
        var stale = true
        var keepUnused = true
        var job: Job? = null
    }

    fun entry(key: String): Entry = entries.getOrPut(key) { Entry(key) }

    fun fetch(e: Entry) {
        val fetcher = e.fetcher ?: return
        if (e.job?.isActive == true) return
        e.state.value = e.state.value.copy(isFetching = true)
        e.job = scope.launch {
            try {
                val data = fetcher()
                e.stale = false
                e.state.value = QueryResult(data = data, error = null, isFetching = false, hasFetched = true)
            } catch (t: kotlinx.coroutines.CancellationException) {
                e.state.value = e.state.value.copy(isFetching = false)
                throw t
            } catch (t: Throwable) {
                // Keep showing the last good data; surface the error only when there is none.
                e.state.value = e.state.value.copy(error = t, isFetching = false, hasFetched = true)
            }
        }
    }

    fun subscribe(e: Entry) {
        e.subscribers++
        if (e.stale || (e.state.value.data == null && e.job?.isActive != true)) fetch(e)
    }

    fun unsubscribe(e: Entry) {
        e.subscribers--
        if (e.subscribers <= 0 && !e.keepUnused) {
            e.job?.cancel()
            entries.remove(e.key)
        }
    }

    /** Mark every cached response carrying one of these tags as stale; refetch the ones on screen. */
    fun invalidate(vararg tags: String) = invalidate(tags.toSet())

    fun invalidate(tags: Collection<String>) {
        entries.values.forEach { e ->
            if (e.tags.any { it in tags }) {
                e.stale = true
                if (e.subscribers > 0) fetch(e)
            }
        }
    }

    /** App came to the foreground / server reachable again: refetch what is on screen. */
    fun refetchActive() {
        entries.values.forEach { e ->
            e.stale = true
            if (e.subscribers > 0) fetch(e)
        }
    }

    /** Sign-out: forget every cached response (RTK `resetApiState`). */
    fun reset() {
        entries.values.forEach { it.job?.cancel() }
        entries.clear()
    }
}

@Stable
class Query internal constructor(private val entry: QueryClient.Entry?, val result: QueryResult) {
    val data get() = result.data
    val error get() = result.error
    val isLoading get() = entry != null && result.isLoading
    val isFetching get() = result.isFetching
    val isSkipped get() = entry == null
    fun refetch() {
        entry?.let { QueryClient.fetch(it) }
    }
}

/**
 * Subscribe a screen to a cached request. [key] identifies the request (endpoint
 * plus arguments); [skip] mirrors RTK's `skip`; [pollMs] its `pollingInterval`;
 * [keep] = false is `keepUnusedDataFor: 0` (always fresh, dropped when unused).
 */
@Composable
fun rememberQuery(
    key: String,
    tags: Set<String> = emptySet(),
    skip: Boolean = false,
    pollMs: Long = 0,
    keep: Boolean = true,
    fetch: suspend () -> JsonElement,
): Query {
    if (skip) return remember { Query(null, QueryResult()) }
    val entry = remember(key) { QueryClient.entry(key) }
    entry.tags = tags
    entry.fetcher = fetch
    entry.keepUnused = keep
    DisposableEffect(entry) {
        QueryClient.subscribe(entry)
        onDispose { QueryClient.unsubscribe(entry) }
    }
    if (pollMs > 0) {
        LaunchedEffect(entry, pollMs) {
            while (isActive) {
                delay(pollMs)
                QueryClient.fetch(entry)
            }
        }
    }
    val result by entry.state.collectAsState()
    return Query(entry, result)
}

/** Loading flag + launcher for a write (RTK mutation hook). */
@Stable
class Mutation internal constructor(private val scope: CoroutineScope) {
    var isLoading by mutableStateOf(false)
        private set

    /**
     * Run [block]; failures are reported through [onError] (default: an alert with
     * the server's message) instead of crashing the screen.
     */
    fun launch(
        onError: (Throwable) -> Unit = { Dialogs.alert("Something went wrong", errMsg(it)) },
        block: suspend () -> Unit,
    ) {
        if (isLoading) return // double taps must not submit twice
        isLoading = true
        scope.launch {
            try {
                block()
            } catch (t: kotlinx.coroutines.CancellationException) {
                throw t
            } catch (t: Throwable) {
                onError(t)
            } finally {
                isLoading = false
            }
        }
    }
}

@Composable
fun rememberMutation(): Mutation {
    val scope = rememberCoroutineScope()
    return remember { Mutation(scope) }
}
