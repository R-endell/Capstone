package expo.modules.autosms

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AutoSmsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AutoSms")

    AsyncFunction("sendSms") { phoneNumber: String, message: String ->
      val context = appContext.reactContext
        ?: throw Exception("React context is not available")

      val perm = ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
      if (perm != PackageManager.PERMISSION_GRANTED) {
        throw Exception("SEND_SMS permission not granted")
      }

      val cleaned = phoneNumber.trim()
      if (cleaned.isEmpty() || message.isBlank()) {
        throw Exception("Phone number and message are required")
      }

      val smsManager: SmsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(SmsManager::class.java)
      } else {
        @Suppress("DEPRECATION")
        SmsManager.getDefault()
      }

      val parts = smsManager.divideMessage(message)
      if (parts.size > 1) {
        smsManager.sendMultipartTextMessage(cleaned, null, parts, null, null)
      } else {
        smsManager.sendTextMessage(cleaned, null, message, null, null)
      }
      true
    }
  }
}