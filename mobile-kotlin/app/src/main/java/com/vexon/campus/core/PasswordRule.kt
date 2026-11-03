package com.vexon.campus.core

/** The password rule (mirrors server/src/utils/passwordPolicy.js, which is the real check). */
object PasswordRule {
    const val HINT = "8–72 characters with a capital letter, a small letter, a number and a symbol"

    /** The first rule this password breaks, or null. */
    fun problem(p: String): String? = when {
        p.length < 8 -> "Use at least 8 characters."
        p.length > 72 -> "Use at most 72 characters."
        p.none { it in 'A'..'Z' } -> "Include a capital letter."
        p.none { it in 'a'..'z' } -> "Include a small letter."
        p.none { it in '0'..'9' } -> "Include a number."
        p.none { !(it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it.isWhitespace()) } -> "Include a symbol."
        else -> null
    }
}
