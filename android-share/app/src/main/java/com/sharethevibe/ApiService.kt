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
    
    // Lifestream Edge Function URL (new system)
    private const val LIFESTREAM_URL = "" // Lifestream Edge Function URL
    
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

    /**
     * POST a URL to both the old API endpoint AND the new lifestream endpoint.
     * Returns success based on the lifestream result (primary system).
     * 
     * @param apiUrl The old API endpoint URL (from settings)
     * @param apiKey The API key for authentication
     * @param url The URL to share
     * @return Result with success status and optional error message
     */
    fun postUrl(apiUrl: String, apiKey: String, url: String): Result {
        Log.d(TAG, "=== Starting Dual API Request ===")
        Log.d(TAG, "Old API URL: $apiUrl")
        Log.d(TAG, "Lifestream URL: $LIFESTREAM_URL")
        Log.d(TAG, "Sharing URL: $url")
        
        // Run both requests - old endpoint first, then lifestream
        val oldResult = postToOldEndpoint(apiUrl, apiKey, url)
        val lifestreamResult = postToLifestream(apiKey, url)
        
        Log.d(TAG, "Old endpoint result: ${oldResult.success}")
        Log.d(TAG, "Lifestream result: ${lifestreamResult.success}")
        
        // Return lifestream result (primary system)
        return lifestreamResult
    }
    
    /**
     * POST to the old API endpoint (existing articles table)
     */
    private fun postToOldEndpoint(apiUrl: String, apiKey: String, url: String): Result {
        Log.d(TAG, "--- Posting to old endpoint ---")
        
        val jsonBody = JSONObject().apply {
            put("url", url)
        }

        val requestBody = jsonBody.toString().toRequestBody(JSON_MEDIA_TYPE)

        val request = Request.Builder()
            .url(apiUrl)
            .addHeader("apikey", apiKey)
            .addHeader("Authorization", "Bearer $apiKey")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "return=minimal")
            .post(requestBody)
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                val code = response.code
                if (response.isSuccessful) {
                    Log.d(TAG, "✓ Old endpoint: success")
                    Result(true, null)
                } else {
                    Log.w(TAG, "✗ Old endpoint: failed with code $code (non-critical)")
                    Result(false, "Old endpoint error ($code)")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "✗ Old endpoint exception: ${e.message} (non-critical)")
            Result(false, "Old endpoint network error")
        }
    }
    
    /**
     * POST to the new lifestream Edge Function
     */
    private fun postToLifestream(apiKey: String, url: String): Result {
        Log.d(TAG, "--- Posting to lifestream ---")
        
        val jsonBody = JSONObject().apply {
            put("url", url)
            put("source", "phone")
        }
        
        Log.d(TAG, "Lifestream request body: $jsonBody")

        val requestBody = jsonBody.toString().toRequestBody(JSON_MEDIA_TYPE)

        val request = Request.Builder()
            .url(LIFESTREAM_URL)
            .addHeader("Authorization", "Bearer $apiKey")
            .addHeader("Content-Type", "application/json")
            .post(requestBody)
            .build()

        return try {
            Log.d(TAG, "Executing lifestream request...")
            client.newCall(request).execute().use { response ->
                val code = response.code
                val body = response.body?.string() ?: ""
                Log.d(TAG, "Lifestream response code: $code")
                Log.d(TAG, "Lifestream response body: $body")
                
                if (response.isSuccessful) {
                    Log.d(TAG, "✓ Lifestream: success!")
                    Result(true, null)
                } else {
                    Log.e(TAG, "✗ Lifestream: failed with code $code")
                    Result(false, "Server error ($code)")
                }
            }
        } catch (e: java.net.UnknownHostException) {
            Log.e(TAG, "✗ Lifestream unknown host: ${e.message}", e)
            Result(false, "Unable to connect - check URL")
        } catch (e: java.net.ConnectException) {
            Log.e(TAG, "✗ Lifestream connection failed: ${e.message}", e)
            Result(false, "Unable to connect")
        } catch (e: java.net.SocketTimeoutException) {
            Log.e(TAG, "✗ Lifestream timed out: ${e.message}", e)
            Result(false, "Connection timed out")
        } catch (e: Exception) {
            Log.e(TAG, "✗ Lifestream exception: ${e.javaClass.simpleName}")
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
