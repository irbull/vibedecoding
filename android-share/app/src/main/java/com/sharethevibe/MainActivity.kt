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
        const val API_KEY_PREF = "api_key"
        
        // Hardcoded Supabase URL
        const val SUPABASE_URL = "" // Supabase URL
    }

    private lateinit var apiKeyInput: EditText
    private lateinit var saveButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        apiKeyInput = findViewById(R.id.apiKeyInput)
        saveButton = findViewById(R.id.saveButton)

        // Load saved API key
        loadSavedSettings()

        saveButton.setOnClickListener {
            saveSettings()
        }
    }

    private fun loadSavedSettings() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedApiKey = prefs.getString(API_KEY_PREF, "") ?: ""
        apiKeyInput.setText(savedApiKey)
    }

    private fun saveSettings() {
        val apiKey = apiKeyInput.text.toString().trim()

        if (apiKey.isEmpty()) {
            Toast.makeText(this, "Please enter your Supabase anon key", Toast.LENGTH_SHORT).show()
            return
        }

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(API_KEY_PREF, apiKey)
            .apply()

        Toast.makeText(this, "Settings saved!", Toast.LENGTH_SHORT).show()
    }
}
