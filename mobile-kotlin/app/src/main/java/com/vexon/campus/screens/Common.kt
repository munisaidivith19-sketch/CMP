package com.vexon.campus.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.vexon.campus.core.Auth
import com.vexon.campus.core.Query
import com.vexon.campus.core.id
import com.vexon.campus.core.str
import com.vexon.campus.core.get
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.Screen
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/** The signed-in user (never null inside the signed-in app). */
@Composable
fun me(): JsonElement {
    val state by Auth.state.collectAsState()
    return state.user ?: JsonNull
}

val JsonElement?.role: String get() = this["role"].str.orEmpty()

/**
 * The common list screen: a fixed header area, then a pull-to-refresh list of
 * [items] from [q], with loading / error / empty states (RN `FlatList` screens).
 */
@Composable
fun ListScreen(
    q: Query,
    items: (JsonElement) -> List<JsonElement>,
    header: @Composable ColumnScope.() -> Unit,
    empty: @Composable () -> Unit,
    gap: Dp = 12.dp,
    contentPadding: PaddingValues = PaddingValues(start = 16.dp, end = 16.dp, bottom = 40.dp),
    listHeader: (LazyListScope.(JsonElement) -> Unit)? = null,
    row: @Composable (JsonElement) -> Unit,
) {
    Screen(scroll = false) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = header)
        val data = q.data
        when {
            data == null && q.error != null -> Box(Modifier.padding(16.dp)) { ErrorState(q.error) { q.refetch() } }
            data == null -> Loading()
            else -> PullToRefreshBox(isRefreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }, modifier = Modifier.fillMaxSize()) {
                val list = items(data)
                LazyColumn(Modifier.fillMaxSize(), contentPadding = contentPadding, verticalArrangement = Arrangement.spacedBy(gap)) {
                    listHeader?.invoke(this, data)
                    if (list.isEmpty()) item { empty() }
                    items(list, key = { it.id ?: it.hashCode() }) { row(it) }
                }
            }
        }
    }
}

/** Detail screen shell: header + loading / error until [q] has data. */
@Composable
fun DetailScreen(
    q: Query,
    title: String,
    content: @Composable ColumnScope.(JsonElement) -> Unit,
) {
    val data = q.data
    if (data == null) {
        Screen {
            Header(title, back = true)
            if (q.error != null) ErrorState(q.error) { q.refetch() } else Loading()
        }
        return
    }
    Screen(refreshing = q.isFetching, onRefresh = { q.refetch() }) { content(data) }
}

/** Full-width modifier shortcut. */
val Wide = Modifier.fillMaxWidth()
