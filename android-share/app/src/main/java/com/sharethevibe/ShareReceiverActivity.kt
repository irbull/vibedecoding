package com.sharethevibe

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ShareReceiverActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "ShareTheVibe"
        
        // Regex pattern to match URLs
        private val URL_PATTERN = Regex(
            """https?://[^\s<>"{}|\\^`\[\]]+""",
            RegexOption.IGNORE_CASE
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "ShareReceiverActivity onCreate")
        
        // Handle the incoming share intent
        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        Log.d(TAG, "ShareReceiverActivity onNewIntent")
        handleShareIntent(intent)
    }

    private fun handleShareIntent(intent: Intent?) {
        Log.d(TAG, "handleShareIntent called")
        Log.d(TAG, "Intent action: ${intent?.action}")
        Log.d(TAG, "Intent type: ${intent?.type}")
        
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
            Log.d(TAG, "Shared text: $sharedText")
            
            if (sharedText != null) {
                // Extract URL from shared text (handles "Title https://url" format)
                val extractedUrl = extractUrl(sharedText)
                
                if (extractedUrl != null) {
                    Log.d(TAG, "Extracted URL: $extractedUrl")
                    shareUrl(extractedUrl)
                } else {
                    Log.e(TAG, "No URL found in shared content")
                    showToastAndFinish("No URL found in shared content")
                }
            } else {
                Log.e(TAG, "No text in shared content")
                showToastAndFinish("No URL found in shared content")
            }
        } else {
            Log.e(TAG, "Invalid share type")
            showToastAndFinish("Invalid share type")
        }
    }

    /**
     * Extract URL from shared text.
     * Handles cases like "Article Title https://example.com" 
     * by finding and returning just the URL.
     */
    private fun extractUrl(text: String): String? {
        val match = URL_PATTERN.find(text)
        return match?.value
    }

    /**
     * Truncate a URL for display in toasts.
     * Example: "https://example.com/very-long-path..." 
     */
    private fun truncateUrl(url: String, maxLength: Int = 45): String {
        return if (url.length > maxLength) {
            url.take(maxLength) + "..."
        } else {
            url
        }
    }

    private fun shareUrl(url: String) {
        Log.d(TAG, "shareUrl called with: $url")
        
        // Get saved API key
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val apiKey = prefs.getString(MainActivity.API_KEY_PREF, "") ?: ""
        
        // Use hardcoded Supabase URL
        val apiUrl = MainActivity.SUPABASE_URL

        Log.d(TAG, "Using Supabase URL: $apiUrl")
        Log.d(TAG, "API Key length: ${apiKey.length}")

        if (apiKey.isEmpty()) {
            Log.e(TAG, "API key is empty!")
            showToastAndFinish("Please configure API key in Share the Vibe app first")
            return
        }

        // Make the API request in a coroutine
        lifecycleScope.launch {
            try {
                // First, resolve any redirects to get the canonical URL
                val resolvedUrl = withContext(Dispatchers.IO) {
                    ApiService.resolveRedirects(url)
                }
                Log.d(TAG, "Final URL to save: $resolvedUrl")
                
                // Then post to Supabase
                val result = withContext(Dispatchers.IO) {
                    ApiService.postUrl(apiUrl, apiKey, resolvedUrl)
                }
                
                if (result.success) {
                    val displayUrl = truncateUrl(resolvedUrl)
                    showToastAndFinish("Saved: $displayUrl")
                } else {
                    val errorMsg = result.errorMessage ?: "Unknown error"
                    showToastAndFinish("Error: $errorMsg")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Exception in shareUrl coroutine", e)
                showToastAndFinish("Error: ${e.message}")
            }
        }
    }

    private fun showToastAndFinish(message: String) {
        Log.d(TAG, "Showing toast: $message")
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        finish()
    }
}
