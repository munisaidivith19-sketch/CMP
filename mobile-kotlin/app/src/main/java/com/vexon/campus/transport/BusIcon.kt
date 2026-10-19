package com.vexon.campus.transport

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF

/**
 * The bus marker icon — a top-down BUS (front = up), never a car or a pin.
 * Drawn from the same 40×40 geometry as the web map's busMarker.js, so both
 * apps show the identical bus. Body colour = tracking state.
 */
object BusIcon {
    val LIVE = Color.parseColor("#CB0101")
    val STALE = Color.parseColor("#D97706")
    val OFFLINE = Color.parseColor("#6B7280")
    private val WINDOW = Color.parseColor("#DBEAFE")
    private val TYRE = Color.parseColor("#1F2937")

    fun bitmap(bodyColor: Int, sizePx: Int): Bitmap {
        val bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val s = sizePx / 40f
        c.scale(s, s)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        fun rect(x: Float, y: Float, w: Float, h: Float, r: Float, color: Int) {
            p.style = Paint.Style.FILL
            p.color = color
            c.drawRoundRect(RectF(x, y, x + w, y + h), r, r, p)
        }
        // Wheels.
        listOf(6f to 7f, 31f to 7f, 6f to 27f, 31f to 27f).forEach { (x, y) -> rect(x, y, 3f, 6f, 1f, TYRE) }
        // Body with a white outline.
        rect(8f, 2f, 24f, 36f, 6f, bodyColor)
        p.style = Paint.Style.STROKE
        p.strokeWidth = 2f
        p.color = Color.WHITE
        c.drawRoundRect(RectF(8f, 2f, 32f, 38f), 6f, 6f, p)
        // Windscreen (front).
        val ws = Path().apply {
            moveTo(11f, 6.5f)
            quadTo(20f, 3f, 29f, 6.5f)
            lineTo(28f, 11f)
            lineTo(12f, 11f)
            close()
        }
        p.style = Paint.Style.FILL
        p.color = WINDOW
        c.drawPath(ws, p)
        p.style = Paint.Style.STROKE
        p.strokeWidth = 0.8f
        p.color = TYRE
        c.drawPath(ws, p)
        // Side windows.
        listOf(13.5f, 19.5f, 25.5f).forEach { y ->
            rect(11f, y, 3f, 4f, 0.8f, WINDOW)
            rect(26f, y, 3f, 4f, 0.8f, WINDOW)
        }
        // Roof unit and rear bumper.
        rect(16f, 16f, 8f, 10f, 1.5f, Color.argb(89, 255, 255, 255))
        rect(12f, 33f, 16f, 2.5f, 1f, Color.argb(64, 0, 0, 0))
        return bmp
    }
}
