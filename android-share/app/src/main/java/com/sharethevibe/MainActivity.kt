package com.sharethevibe

import android.content.Context
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    companion object {
        const val PREFS_NAME = "ShareTheVibePrefs"
        const val API_URL_PREF = "api_url"
        const val API_KEY_PREF = "api_key"
    }

    private lateinit var apiUrlInput: EditText
    private lateinit var apiKeyInput: EditText
    private lateinit var saveButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        apiUrlInput = findViewById(R.id.apiUrlInput)
        apiKeyInput = findViewById(R.id.apiKeyInput)
        saveButton = findViewById(R.id.saveButton)

        loadSavedSettings()

        saveButton.setOnClickListener {
            saveSettings()
        }
    }

    private fun loadSavedSettings() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedApiUrl = prefs.getString(API_URL_PREF, "") ?: ""
        val savedApiKey = prefs.getString(API_KEY_PREF, "") ?: ""
        apiUrlInput.setText(savedApiUrl)
        apiKeyInput.setText(savedApiKey)
    }

    private fun saveSettings() {
        val apiUrl = apiUrlInput.text.toString().trim()
        val apiKey = apiKeyInput.text.toString().trim()

        if (apiUrl.isEmpty()) {
            Toast.makeText(this, "Please enter your Lifestream URL", Toast.LENGTH_SHORT).show()
            return
        }

        if (apiKey.isEmpty()) {
            Toast.makeText(this, "Please enter your API key", Toast.LENGTH_SHORT).show()
            return
        }

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(API_URL_PREF, apiUrl)
            .putString(API_KEY_PREF, apiKey)
            .apply()

        Toast.makeText(this, "Settings saved!", Toast.LENGTH_SHORT).show()
    }
}
