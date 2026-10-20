package com.vexon.campus.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Safe API URLs. Every id that goes into a path is checked first, and the URL
 * is built segment by segment with [HttpUrl.Builder.addPathSegment] — never by
 * pasting strings together — so a value from a notification, a deep link or a
 * server payload can never add a path segment, a query string or "..".
 *
 * Path templates in [Api] wrap each variable part: `"/gate-pass/${oid(id)}/qr"`.
 * A value that fails its check becomes [INVALID]; [url] then refuses the whole
 * request (no request is sent). Nothing here throws while a screen is being
 * composed.
 */
object ApiPath {
    private val OBJECT_ID = Regex("^[0-9a-f]{24}$")
    private val SLUG = Regex("^[a-z0-9][a-z0-9-]{0,79}$")
    private val KEYWORD = Regex("^[a-z0-9][a-z0-9_-]{0,39}$")

    /** Marks a rejected path value; never a valid segment (NUL is not allowed in a path). */
    const val INVALID = "\u0000"

    /** A MongoDB ObjectId: exactly 24 lowercase hex characters. */
    fun isObjectId(value: String?): Boolean = value != null && OBJECT_ID.matches(value)

    fun oid(value: String?): String = if (isObjectId(value)) value!! else INVALID
    fun slug(value: String?): String = if (value != null && SLUG.matches(value)) value else INVALID
    fun keyword(value: String?): String = if (value != null && KEYWORD.matches(value)) value else INVALID

    /**
     * `${base}/api` + [path], each "/"-separated segment added with
     * addPathSegment (so it is percent-encoded and stays one segment), plus the
     * query [params]. Null when the base is not an http(s) URL or the path holds
     * an empty, ".", ".." or rejected segment.
     */
    fun url(base: String, path: String, params: Map<String, Any?>? = null, omit: Any? = null): HttpUrl? {
        val root = base.trim().trimEnd('/').toHttpUrlOrNull() ?: return null
        if (!path.startsWith("/")) return null
        val segments = path.substring(1).split('/')
        if (segments.any { it.isEmpty() || it == "." || it == ".." || it.contains(INVALID) || it.contains('\\') }) return null
        // Any path the server URL itself has (e.g. https://host/campus) is kept.
        val b = root.newBuilder()
        b.addPathSegment("api")
        segments.forEach { b.addPathSegment(it) }
        params?.forEach { (k, v) ->
            when {
                v == null || (omit != null && v === omit) -> Unit
                v is Iterable<*> -> v.forEach { item -> if (item != null) b.addQueryParameter(k, item.toString()) }
                else -> b.addQueryParameter(k, v.toString())
            }
        }
        return b.build()
    }
}

/** Shorthands for path templates in [Api]. */
fun oid(value: String?): String = ApiPath.oid(value)
fun slug(value: String?): String = ApiPath.slug(value)
fun keyword(value: String?): String = ApiPath.keyword(value)
