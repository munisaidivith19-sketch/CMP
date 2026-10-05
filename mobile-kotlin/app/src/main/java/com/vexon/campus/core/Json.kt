package com.vexon.campus.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * The backend is shared with the web app and its responses are read the same way
 * the JavaScript client reads them: by field name, tolerating missing values.
 * These helpers give that `d["stats"]["myClubs"].int` style on top of
 * kotlinx.serialization's JsonElement, where a missing key or JSON null is `null`.
 */
val JsonCodec = Json { ignoreUnknownKeys = true; isLenient = true; explicitNulls = false }

operator fun JsonElement?.get(key: String): JsonElement? =
    (this as? JsonObject)?.get(key)?.takeUnless { it is JsonNull }

operator fun JsonElement?.get(index: Int): JsonElement? =
    (this as? JsonArray)?.getOrNull(index)?.takeUnless { it is JsonNull }

/** String value of a primitive (numbers and booleans too, like JS template strings). */
val JsonElement?.str: String?
    get() = (this as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content

/** Non-blank string or null. */
val JsonElement?.text: String? get() = str?.takeIf { it.isNotBlank() }

val JsonElement?.dbl: Double? get() = (this as? JsonPrimitive)?.let { it.doubleOrNull ?: it.content.toDoubleOrNull() }
val JsonElement?.int: Int? get() = dbl?.toInt()
val JsonElement?.long: Long? get() = dbl?.toLong()

/** JS truthiness for booleans: missing / null / false → false. */
val JsonElement?.bool: Boolean get() = (this as? JsonPrimitive)?.booleanOrNull ?: false
val JsonElement?.boolOrNull: Boolean? get() = (this as? JsonPrimitive)?.booleanOrNull

val JsonElement?.list: List<JsonElement> get() = (this as? JsonArray)?.filterNot { it is JsonNull } ?: emptyList()
val JsonElement?.obj: JsonObject? get() = this as? JsonObject
val JsonElement?.isArray: Boolean get() = this is JsonArray

/** A Mongo document id: either a populated `{ _id }` object or a bare id string. */
val JsonElement?.id: String? get() = this["_id"].str ?: str

/** `sameId` from utils/format.js. */
fun sameId(a: JsonElement?, b: JsonElement?): Boolean = a.id != null && a.id == b.id
fun sameId(a: JsonElement?, b: String?): Boolean = b != null && a.id == b

/** Strings from an array of primitives. */
val JsonElement?.strings: List<String> get() = list.mapNotNull { it.str }

// ── Building request bodies ─────────────────────────────────────────────

fun toJson(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Map<*, *> -> JsonObject(value.entries.filter { it.value !== Omit }.associate { it.key.toString() to toJson(it.value) })
    is Iterable<*> -> JsonArray(value.map { toJson(it) })
    is Array<*> -> JsonArray(value.map { toJson(it) })
    else -> JsonPrimitive(value.toString())
}

/** Marker to leave a key out of [jsonOf] (JS `undefined`). */
object Omit

/** `jsonOf("a" to 1, "b" to listOf("x"))` → `{"a":1,"b":["x"]}`; [Omit] values are dropped. */
fun jsonOf(vararg pairs: Pair<String, Any?>): JsonObject =
    JsonObject(pairs.filter { it.second !== Omit }.associate { it.first to toJson(it.second) })

/** Copy of an object with some keys replaced (immutable `{ ...o, k: v }`). */
fun JsonElement?.with(vararg pairs: Pair<String, Any?>): JsonObject =
    JsonObject((this as? JsonObject ?: JsonObject(emptyMap())) + pairs.associate { it.first to toJson(it.second) })

/** Shallow merge of two objects (JS `{ ...a, ...b }`). */
fun JsonElement?.merge(other: JsonElement?): JsonObject =
    JsonObject((this as? JsonObject ?: JsonObject(emptyMap())) + (other as? JsonObject ?: JsonObject(emptyMap())))

fun parseJson(text: String): JsonElement? = runCatching { JsonCodec.parseToJsonElement(text) }.getOrNull()
