package app.beacon.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Reinicia WsService tras reboot del device.
 * Declarado en AndroidManifest.xml con BOOT_COMPLETED + QUICKBOOT_POWERON intents.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            val prefs = context.getSharedPreferences("beacon_ws", Context.MODE_PRIVATE)
            val host = prefs.getString("host", null) ?: return
            val token = prefs.getString("token", null) ?: return
            val port = prefs.getInt("port", 7890)

            val svc = Intent(context, WsService::class.java).apply {
                action = WsService.ACTION_START
                putExtra(WsService.EXTRA_HOST, host)
                putExtra(WsService.EXTRA_PORT, port)
                putExtra(WsService.EXTRA_TOKEN, token)
            }
            ContextCompat.startForegroundService(context, svc)
        }
    }
}
