# Pear Desktop API Server Plugin Documentation

## Overview

The API Server plugin for Pear Desktop (formerly YouTube Music Desktop App) provides a REST API and WebSocket interface for controlling the music player remotely. The plugin is located at `src/plugins/api-server/` in the repository.

**Repository:** https://github.com/pear-devs/pear-desktop  
**Plugin Location:** `src/plugins/api-server/`  
**API Version:** `v1`  
**Default Port:** `26538`  
**Default Hostname:** `0.0.0.0`

## Configuration

The API server can be configured with the following options:

```typescript
{
  enabled: boolean;           // Enable/disable the API server
  hostname: string;           // Server hostname (default: '0.0.0.0')
  port: number;               // Server port (default: 26538)
  authStrategy: AuthStrategy; // 'AUTH_AT_FIRST' or 'NONE'
  secret: string;             // JWT secret for token signing
  authorizedClients: string[]; // List of authorized client IDs
  useHttps: boolean;          // Enable HTTPS
  certPath: string;           // Path to SSL certificate
  keyPath: string;            // Path to SSL private key
}
```

## Authentication

### Get Access Token

**Endpoint:** `POST /auth/{id}`  
**Security:** None (public endpoint)

**Request:**
- **Path Parameters:**
  - `id` (string): Client identifier

**Response:**
- **200 OK:**
  ```json
  {
    "accessToken": "string"
  }
  ```
- **403 Forbidden:** Request denied

**Note:** When `authStrategy` is set to `AUTH_AT_FIRST`, a dialog will appear asking for permission. The client ID will be added to `authorizedClients` upon approval.

**Usage:** All API endpoints under `/api/*` require authentication via Bearer token in the Authorization header:
```
Authorization: Bearer <accessToken>
```

## API Endpoints

All API endpoints are prefixed with `/api/v1/` and require authentication (unless `authStrategy` is `NONE`).

### Player Control

#### Play Previous Song
**Endpoint:** `POST /api/v1/previous`  
**Description:** Plays the previous song in the queue

**Response:**
- **204 No Content:** Success

---

#### Play Next Song
**Endpoint:** `POST /api/v1/next`  
**Description:** Plays the next song in the queue

**Response:**
- **204 No Content:** Success

---

#### Play
**Endpoint:** `POST /api/v1/play`  
**Description:** Change the state of the player to play

**Response:**
- **204 No Content:** Success

---

#### Pause
**Endpoint:** `POST /api/v1/pause`  
**Description:** Change the state of the player to pause

**Response:**
- **204 No Content:** Success

---

#### Toggle Play/Pause
**Endpoint:** `POST /api/v1/toggle-play`  
**Description:** Toggle between play and pause states

**Response:**
- **204 No Content:** Success

---

### Song Information

#### Get Current Song Info
**Endpoint:** `GET /api/v1/song`  
**Description:** Get information about the currently playing song

**Response:**
- **200 OK:**
  ```json
  {
    "title": "string",
    "artist": "string",
    "views": "number",
    "uploadDate": "string",        // optional
    "imageSrc": "string",          // nullable, optional - album art/thumbnail URL
    "isPaused": "boolean",         // optional
    "songDuration": "number",       // duration in seconds
    "elapsedSeconds": "number",    // optional - current position
    "url": "string",               // optional
    "album": "string",             // nullable, optional
    "videoId": "string",
    "playlistId": "string",        // optional
    "mediaType": "Audio" | "OriginalMusicVideo" | "UserGeneratedContent" | "PodcastEpisode" | "OtherVideo"
  }
  ```
- **204 No Content:** No song currently playing

**Deprecated Endpoint:** `GET /api/v1/song-info` (use `/api/v1/song` instead)

---

#### Get Next Song Info
**Endpoint:** `GET /api/v1/queue/next`  
**Description:** Get information about the next song in the queue (relative index +1)

**Response:**
- **200 OK:** Song info object (same format as `/api/v1/song`)
- **204 No Content:** No next song in queue

---

### Volume Control

#### Get Volume State
**Endpoint:** `GET /api/v1/volume`  
**Description:** Get the current volume state

**Response:**
- **200 OK:**
  ```json
  {
    "state": "number",      // Volume level (0-100)
    "isMuted": "boolean"    // Mute state
  }
  ```

---

#### Set Volume
**Endpoint:** `POST /api/v1/volume`  
**Description:** Set the volume level

**Request Body:**
```json
{
  "volume": "number"  // Volume level (0-100)
}
```

**Response:**
- **204 No Content:** Success

---

#### Toggle Mute
**Endpoint:** `POST /api/v1/toggle-mute`  
**Description:** Toggle the mute state

**Response:**
- **204 No Content:** Success

---

### Seek Control

#### Seek To Position
**Endpoint:** `POST /api/v1/seek-to`  
**Description:** Seek to a specific time in the current song

**Request Body:**
```json
{
  "seconds": "number"  // Target position in seconds
}
```

**Response:**
- **204 No Content:** Success

---

#### Go Back
**Endpoint:** `POST /api/v1/go-back`  
**Description:** Move the current song back by a number of seconds

**Request Body:**
```json
{
  "seconds": "number"  // Seconds to go back
}
```

**Response:**
- **204 No Content:** Success

---

#### Go Forward
**Endpoint:** `POST /api/v1/go-forward`  
**Description:** Move the current song forward by a number of seconds

**Request Body:**
```json
{
  "seconds": "number"  // Seconds to go forward
}
```

**Response:**
- **204 No Content:** Success

---

### Like/Dislike

#### Get Like State
**Endpoint:** `GET /api/v1/like-state`  
**Description:** Get the current like state of the song

**Response:**
- **200 OK:**
  ```json
  {
    "state": "LIKE" | "DISLIKE" | "INDIFFERENT" | null
  }
  ```

---

#### Like Song
**Endpoint:** `POST /api/v1/like`  
**Description:** Set the current song as liked

**Response:**
- **204 No Content:** Success

---

#### Dislike Song
**Endpoint:** `POST /api/v1/dislike`  
**Description:** Set the current song as disliked

**Response:**
- **204 No Content:** Success

---

### Repeat Mode

#### Get Repeat Mode
**Endpoint:** `GET /api/v1/repeat-mode`  
**Description:** Get the current repeat mode

**Response:**
- **200 OK:**
  ```json
  {
    "mode": "NONE" | "ALL" | "ONE" | null
  }
  ```

---

#### Switch Repeat Mode
**Endpoint:** `POST /api/v1/switch-repeat`  
**Description:** Switch the repeat mode

**Request Body:**
```json
{
  "iteration": "number"  // Number of times to click the repeat button
}
```

**Response:**
- **204 No Content:** Success

---

### Shuffle

#### Get Shuffle State
**Endpoint:** `GET /api/v1/shuffle`  
**Description:** Get the current shuffle state

**Response:**
- **200 OK:**
  ```json
  {
    "state": "boolean" | null
  }
  ```

---

#### Toggle Shuffle
**Endpoint:** `POST /api/v1/shuffle`  
**Description:** Shuffle the queue

**Response:**
- **204 No Content:** Success

---

### Queue Management

#### Get Queue Info
**Endpoint:** `GET /api/v1/queue`  
**Description:** Get the current queue information

**Response:**
- **200 OK:** Queue object (structure depends on YouTube Music's internal format)
- **204 No Content:** No queue info available

**Deprecated Endpoint:** `GET /api/v1/queue-info` (use `/api/v1/queue` instead)

---

#### Add Song to Queue
**Endpoint:** `POST /api/v1/queue`  
**Description:** Add a song to the queue

**Request Body:**
```json
{
  "videoId": "string",        // YouTube video ID
  "insertPosition": "number"  // Optional: position to insert at
}
```

**Response:**
- **204 No Content:** Success

---

#### Move Song in Queue
**Endpoint:** `PATCH /api/v1/queue/{index}`  
**Description:** Move a song in the queue to a different position

**Path Parameters:**
- `index` (number): Current index of the song

**Request Body:**
```json
{
  "toIndex": "number"  // Target index to move to
}
```

**Response:**
- **204 No Content:** Success

---

#### Remove Song from Queue
**Endpoint:** `DELETE /api/v1/queue/{index}`  
**Description:** Remove a song from the queue

**Path Parameters:**
- `index` (number): Index of the song to remove

**Response:**
- **204 No Content:** Success

---

#### Set Queue Index
**Endpoint:** `PATCH /api/v1/queue`  
**Description:** Set the current index of the queue (jump to a specific song)

**Request Body:**
```json
{
  "index": "number"  // Index to jump to
}
```

**Response:**
- **204 No Content:** Success

---

#### Clear Queue
**Endpoint:** `DELETE /api/v1/queue`  
**Description:** Clear the entire queue

**Response:**
- **204 No Content:** Success

---

### Fullscreen Control

#### Get Fullscreen State
**Endpoint:** `GET /api/v1/fullscreen`  
**Description:** Get the current fullscreen state

**Response:**
- **200 OK:**
  ```json
  {
    "state": "boolean"
  }
  ```

---

#### Set Fullscreen
**Endpoint:** `POST /api/v1/fullscreen`  
**Description:** Set the fullscreen state

**Request Body:**
```json
{
  "state": "boolean"  // true for fullscreen, false for windowed
}
```

**Response:**
- **204 No Content:** Success

---

### Search

#### Search for Songs
**Endpoint:** `POST /api/v1/search`  
**Description:** Search for songs

**Request Body:**
```json
{
  "query": "string",           // Search query
  "params": "object",          // Optional: additional parameters
  "continuation": "string"     // Optional: continuation token for pagination
}
```

**Response:**
- **200 OK:** Search results object (structure depends on YouTube Music's internal format)

---

## WebSocket API

### WebSocket Endpoint

**Endpoint:** `GET /api/v1/ws`  
**Description:** WebSocket endpoint for real-time player updates

**Connection:** Upgrade to WebSocket protocol

**Message Types:**

The WebSocket sends JSON messages with the following structure:

```json
{
  "type": "PLAYER_INFO" | "VIDEO_CHANGED" | "PLAYER_STATE_CHANGED" | "POSITION_CHANGED" | "VOLUME_CHANGED" | "REPEAT_CHANGED" | "SHUFFLE_CHANGED",
  // Additional fields based on type:
  "song": { /* SongInfo object */ },      // For PLAYER_INFO, VIDEO_CHANGED
  "isPlaying": "boolean",                 // For PLAYER_INFO, PLAYER_STATE_CHANGED
  "muted": "boolean",                     // For PLAYER_INFO, VOLUME_CHANGED
  "position": "number",                  // For PLAYER_INFO, PLAYER_STATE_CHANGED, POSITION_CHANGED
  "volume": "number",                    // For PLAYER_INFO, VOLUME_CHANGED
  "repeat": "NONE" | "ALL" | "ONE",     // For PLAYER_INFO, REPEAT_CHANGED
  "shuffle": "boolean"                    // For PLAYER_INFO, SHUFFLE_CHANGED
}
```

**Event Types:**
- `PLAYER_INFO`: Initial state sent when WebSocket connects
- `VIDEO_CHANGED`: Sent when a new song starts playing
- `PLAYER_STATE_CHANGED`: Sent when play/pause state changes
- `POSITION_CHANGED`: Sent when playback position changes
- `VOLUME_CHANGED`: Sent when volume or mute state changes
- `REPEAT_CHANGED`: Sent when repeat mode changes
- `SHUFFLE_CHANGED`: Sent when shuffle state changes

---

## API Documentation (Swagger)

The API server includes built-in Swagger documentation:

- **Swagger UI:** `GET /swagger`
- **OpenAPI Spec:** `GET /doc`

Access these endpoints in a browser to view interactive API documentation.

---

## Summary of Key Endpoints

### Requested Endpoints:

1. **Get Current Song Info** ✅
   - `GET /api/v1/song`
   - Returns: title, artist, album art (imageSrc), thumbnail, duration, position, etc.

2. **Play/Pause Control** ✅
   - `POST /api/v1/play` - Play
   - `POST /api/v1/pause` - Pause
   - `POST /api/v1/toggle-play` - Toggle play/pause

3. **Next Track** ✅
   - `POST /api/v1/next`

4. **Previous Track** ✅
   - `POST /api/v1/previous`

5. **Volume Control** ✅
   - `GET /api/v1/volume` - Get volume state
   - `POST /api/v1/volume` - Set volume
   - `POST /api/v1/toggle-mute` - Toggle mute

---

## Example Usage

### 1. Authenticate and Get Token

```bash
curl -X POST http://localhost:26538/auth/my-client-id
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 2. Get Current Song Info

```bash
curl -X GET http://localhost:26538/api/v1/song \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 3. Play Next Song

```bash
curl -X POST http://localhost:26538/api/v1/next \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 4. Set Volume

```bash
curl -X POST http://localhost:26538/api/v1/volume \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"volume": 75}'
```

### 5. Toggle Play/Pause

```bash
curl -X POST http://localhost:26538/api/v1/toggle-play \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Notes

- All endpoints return `204 No Content` for successful operations that don't return data
- The API uses JWT tokens for authentication (unless `authStrategy` is set to `NONE`)
- The default port is `26538` but can be configured
- HTTPS is supported if certificates are provided in the configuration
- CORS is enabled for all endpoints
- The WebSocket endpoint provides real-time updates without polling
- Some endpoints may return `204 No Content` when there's no data (e.g., no song playing, no queue)
