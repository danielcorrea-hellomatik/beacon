package app.beacon.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.Response
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.min

/**
 * Foreground Service que mantiene un WebSocket persistente al bridge.
 *
 * Persiste:
 *  - Reconexión exponencial (1s → 30s cap) ante errores
 *  - Ping/pong cada 20s para detectar conexión muerta
 *  - WakeLock parcial mientras está conectado
 *  - Notificación persistente requerida por Android 14+ (foregroundServiceType=dataSync)
 *
 * Activación: invocado desde el plugin Tauri custom (cmd start_ws_service).
 * Desactivación: stopService() desde Tauri, o BootReceiver al reiniciar.
 */
class WsService : Service() {

    companion object {
        const val CHANNEL_ID = "beacon_ws"
        const val NOTIF_ID = 1001
        const val ACTION_START = "app.beacon.START"
        const val ACTION_STOP = "app.beacon.STOP"
        const val EXTRA_HOST = "host"
        const val EXTRA_PORT = "port"
        const val EXTRA_TOKEN = "token"
        const val TAG = "BeaconWS"
    }

    private val client by lazy {
        OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()
    }

    private var ws: WebSocket? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var reconnectAttempt = 0
    private var shouldRun = false

    private lateinit var prefs: SharedPreferences

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences("beacon_ws", MODE_PRIVATE)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                shutdown()
                return START_NOT_STICKY
            }
            ACTION_START, null -> {
                val host = intent?.getStringExtra(EXTRA_HOST) ?: prefs.getString("host", null)
                val port = intent?.getIntExtra(EXTRA_PORT, -1)?.takeIf { it > 0 } ?: prefs.getInt("port", 7890)
                val token = intent?.getStringExtra(EXTRA_TOKEN) ?: prefs.getString("token", null)

                if (host == null || token == null) {
                    Log.w(TAG, "Missing host/token, stopping service")
                    stopSelf()
                    return START_NOT_STICKY
                }

                prefs.edit().putString("host", host).putInt("port", port).putString("token", token).apply()

                startForeground(NOTIF_ID, buildNotification("Conectando…"))
                acquireWakeLock()
                shouldRun = true
                connect(host, port, token)
            }
        }
        return START_STICKY
    }

    private fun connect(host: String, port: Int, token: String) {
        if (!shouldRun) return
        val url = "ws://$host:$port/stream?token=${java.net.URLEncoder.encode(token, "UTF-8")}"
        Log.i(TAG, "Connecting to $url (attempt $reconnectAttempt)")

        val request = Request.Builder().url(url).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Connected")
                reconnectAttempt = 0
                updateNotification("Conectado · $host")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleEvent(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                handleEvent(bytes.utf8())
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "Closing: $code $reason")
                scheduleReconnect(host, port, token)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "Failure: ${t.message}")
                updateNotification("Reconectando…")
                scheduleReconnect(host, port, token)
            }
        })
    }

    private fun handleEvent(json: String) {
        try {
            val obj = JSONObject(json)
            val kind = obj.optString("kind")
            // Emite el evento al Tauri webview (via plugin bridge)
            // En la implementación real: BeaconPlugin.emit("ws_event", obj)
            Log.d(TAG, "Event: $kind")
        } catch (e: Exception) {
            Log.w(TAG, "Bad JSON: ${e.message}")
        }
    }

    private fun scheduleReconnect(host: String, port: Int, token: String) {
        if (!shouldRun) return
        val delaySec = min(30, 1 shl reconnectAttempt.coerceAtMost(5))
        reconnectAttempt++
        android.os.Handler(mainLooper).postDelayed({ connect(host, port, token) }, delaySec * 1000L)
    }

    private fun shutdown() {
        shouldRun = false
        ws?.close(1000, "shutdown")
        ws = null
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Notification helpers ──────────────────────────────────────────────
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Beacon WebSocket", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Mantiene la conexión al bridge en background" }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Beacon")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)   // TODO: icon propio
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        val mgr = getSystemService(NotificationManager::class.java)
        mgr.notify(NOTIF_ID, buildNotification(text))
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "beacon:ws").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }
}
