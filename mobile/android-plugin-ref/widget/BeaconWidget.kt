package app.beacon.mobile.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import app.beacon.mobile.MainActivity
import app.beacon.mobile.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Widget Android home screen para Beacon.
 *
 * Muestra:
 *  - 🦀 N sesiones activas (badge naranja)
 *  - K tokens hoy (compact_number)
 *  - Ámbar si idle alert pendiente
 *
 * Update cada 15 minutos (mínimo permitido por Android para widgets sin alarmas custom).
 * Si quieres más frecuencia, usa WorkManager.
 *
 * Click → abre la app (MainActivity con deeplink beacon://).
 *
 * Configuración: el widget lee host/token de SharedPreferences "beacon_ws"
 * (las mismas que usa WsService). Si no hay devices configurados, muestra
 * placeholder "Vincular Mac".
 */
class BeaconWidget : AppWidgetProvider() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .readTimeout(2, TimeUnit.SECONDS)
        .build()

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            updateWidget(context, manager, id)
        }
    }

    private fun updateWidget(context: Context, manager: AppWidgetManager, widgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.beacon_widget)

        // Click sobre cualquier punto → abre app
        val intent = Intent(context, MainActivity::class.java).apply {
            data = Uri.parse("beacon://")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        val pending = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pending)

        // Fetch stats del bridge primario (el primero configurado)
        val prefs = context.getSharedPreferences("beacon_ws", Context.MODE_PRIVATE)
        val host = prefs.getString("host", null)
        val port = prefs.getInt("port", 7890)
        val token = prefs.getString("token", null)

        if (host == null || token == null) {
            views.setTextViewText(R.id.widget_title, "Beacon")
            views.setTextViewText(R.id.widget_main, "—")
            views.setTextViewText(R.id.widget_sub, "Vincula un Mac")
            manager.updateAppWidget(widgetId, views)
            return
        }

        scope.launch {
            try {
                val req = Request.Builder()
                    .url("http://$host:$port/api/sessions?status=working")
                    .header("X-Beacon-Token", token)
                    .build()
                val resp = client.newCall(req).execute()
                val body = resp.body?.string() ?: "[]"
                val arr = org.json.JSONArray(body)
                val active = arr.length()

                // Stats globales
                val statsReq = Request.Builder()
                    .url("http://$host:$port/api/stats")
                    .header("X-Beacon-Token", token)
                    .build()
                val statsBody = client.newCall(statsReq).execute().body?.string() ?: "{}"
                val statsJson = JSONObject(statsBody)
                val local = statsJson.optJSONObject("local")
                val tokens = (local?.optLong("tokens_in") ?: 0) + (local?.optLong("tokens_out") ?: 0)

                views.setTextViewText(R.id.widget_title, "Beacon · ${prefs.getString("name", "Mac")}")
                views.setTextViewText(R.id.widget_main, if (active > 0) "🦀 $active" else "✓")
                views.setTextViewText(R.id.widget_sub, "${compactNumber(tokens)} tokens hoy")

                manager.updateAppWidget(widgetId, views)
            } catch (e: Exception) {
                views.setTextViewText(R.id.widget_title, "Beacon")
                views.setTextViewText(R.id.widget_main, "⚠")
                views.setTextViewText(R.id.widget_sub, "Offline")
                manager.updateAppWidget(widgetId, views)
            }
        }
    }

    private fun compactNumber(n: Long): String = when {
        n >= 1_000_000_000 -> "${(n / 100_000_000) / 10.0}B"
        n >= 1_000_000     -> "${(n / 100_000) / 10.0}M"
        n >= 1_000         -> "${(n / 100) / 10.0}K"
        else -> n.toString()
    }
}
