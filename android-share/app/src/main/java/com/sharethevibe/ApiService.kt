package com.sharethevibe

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object ApiService {

    private const val TAG = "ShareTheVibe"

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

    /**
     * POST a URL to the Lifestream endpoint.
     *
     * @param apiUrl The Lifestream API endpoint URL (from settings)
     * @param apiKey The API key for authentication
     * @param url The URL to share
     * @return Result with success status and optional error message
     */
    fun postUrl(apiUrl: String, apiKey: String, url: String): Result {
        Log.d(TAG, "=== Posting to Lifestream ===")
        Log.d(TAG, "API URL: $apiUrl")
        Log.d(TAG, "Sharing URL: $url")

        val jsonBody = JSONObject().apply {
            put("url", url)
            put("source", "phone")
        }

        Log.d(TAG, "Request body: $jsonBody")

        val requestBody = jsonBody.toString().toRequestBody(JSON_MEDIA_TYPE)

        val request = Request.Builder()
            .url(apiUrl)
            .addHeader("Authorization", "Bearer $apiKey")
            .addHeader("Content-Type", "application/json")
            .post(requestBody)
            .build()

        return try {
            Log.d(TAG, "Executing request...")
            client.newCall(request).execute().use { response ->
                val code = response.code
                val body = response.body?.string() ?: ""
                Log.d(TAG, "Response code: $code")
                Log.d(TAG, "Response body: $body")

                if (response.isSuccessful) {
                    Log.d(TAG, "✓ Success!")
                    Result(true, null)
                } else {
                    Log.e(TAG, "✗ Failed with code $code")
                    Result(false, "Server error ($code)")
                }
            }
        } catch (e: java.net.UnknownHostException) {
            Log.e(TAG, "✗ Unknown host: ${e.message}", e)
            Result(false, "Unable to connect - check URL")
        } catch (e: java.net.ConnectException) {
            Log.e(TAG, "✗ Connection failed: ${e.message}", e)
            Result(false, "Unable to connect")
        } catch (e: java.net.SocketTimeoutException) {
            Log.e(TAG, "✗ Timed out: ${e.message}", e)
            Result(false, "Connection timed out")
        } catch (e: Exception) {
            Log.e(TAG, "✗ Exception: ${e.javaClass.simpleName}")
            Log.e(TAG, "Exception message: ${e.message}")
            Log.e(TAG, "Stack trace:", e)
            Result(false, "Network error")
        }
    }

    data class Result(val success: Boolean, val errorMessage: String?)

    /**
     * Resolve redirects and return the final/canonical URL.
     * Uses a GET request to follow redirects (some servers don't redirect HEAD requests).
     * 
     * @param url The original URL (possibly a redirect/tracking link)
     * @return The final URL after following all redirects, or the original URL if resolution fails
     */
    fun resolveRedirects(url: String): String {
        Log.d(TAG, "=== Resolving redirects for: $url ===")
        
        return try {
            val request = Request.Builder()
                .url(url)
                .get()  // GET request - some servers (like Google) don't redirect HEAD requests
                .build()
            
            client.newCall(request).execute().use { response ->
                // OkHttp follows redirects automatically by default
                // response.request.url gives us the final URL after all redirects
                val finalUrl = response.request.url.toString()
                
                if (finalUrl != url) {
                    Log.d(TAG, "✓ Resolved to: $finalUrl")
                } else {
                    Log.d(TAG, "✓ No redirects (URL unchanged)")
                }
                
                finalUrl
            }
        } catch (e: Exception) {
            Log.e(TAG, "✗ Failed to resolve redirects: ${e.message}")
            Log.d(TAG, "Falling back to original URL")
            url  // Return original URL on failure
        }
    }
}
