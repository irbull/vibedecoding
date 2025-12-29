# Share the Vibe 📤

An Android app that allows you to share links to Supabase (or any compatible REST API).

## Features

- **Share Target**: Appears in Android's share sheet when sharing URLs from any app
- **Supabase Integration**: Stores links directly in your Supabase database
- **Simple JSON Format**: POSTs `{ "url": "<shared_url>" }` to your endpoint

## Setup

### 1. Supabase Setup

1. Create a [Supabase](https://supabase.com) project
2. Create the `articles` table:
   ```sql
   CREATE TABLE articles (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     url TEXT NOT NULL,
     title TEXT,
     summary TEXT,
     tags TEXT[] DEFAULT '{}',
     notes TEXT,
     thumbnail TEXT,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );
   ```
3. Enable Row Level Security and add policies:
   ```sql
   ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

   -- Allow inserts
   CREATE POLICY "Allow inserts" ON articles
     FOR INSERT WITH CHECK (true);

   -- Allow public read
   CREATE POLICY "Allow public read" ON articles
     FOR SELECT USING (true);
   ```
4. Get your **Project URL** and **anon key** from Project Settings → API

### 2. App Setup

1. **Install the app** on your Android device
2. **Open the app** and enter your Supabase **anon** (public) key
3. **Tap Save Settings**

> **Note**: The Supabase URL is hardcoded in the app. If you need to change it, update `MainActivity.SUPABASE_URL` and rebuild.

## Usage

1. In any app (browser, Twitter, etc.), tap the **Share** button
2. Select **"Share the Vibe"** from the share menu
3. The URL will be POSTed to your configured endpoint
4. You'll see a toast confirmation: "Link shared!" or "Error sharing link"

## API Request Format

When you share a link, the app makes the following HTTP request to Supabase:

```
POST https://<project>.supabase.co/rest/v1/articles
Content-Type: application/json
apikey: <your-anon-key>
Authorization: Bearer <your-anon-key>
Prefer: return=minimal

{
  "url": "<shared_url>"
}
```

## Building

### Requirements
- Java 17+
- Android SDK (API 34)

### Build Debug APK
```bash
./gradlew assembleDebug
```

The APK will be at: `app/build/outputs/apk/debug/app-debug.apk`

### Install on Connected Device
```bash
./gradlew installDebug
```

### Build Release APK
```bash
./gradlew assembleRelease
```

## Project Structure

```
app/src/main/
├── java/com/sharethevibe/
│   ├── MainActivity.kt          # Settings screen
│   ├── ShareReceiverActivity.kt # Handles incoming shares
│   └── ApiService.kt            # HTTP client
├── res/
│   ├── layout/activity_main.xml # Settings UI
│   ├── values/
│   │   ├── strings.xml
│   │   ├── colors.xml
│   │   └── themes.xml
│   └── drawable/
│       └── ic_launcher_foreground.xml
└── AndroidManifest.xml
```

## Future Improvements

- [ ] Auto-fetch page title and summary when sharing
- [ ] Add tags/notes input before sharing
- [ ] Support sharing images and other media types
- [ ] Add offline queue for failed shares
- [ ] View shared links history in app

## License

MIT
