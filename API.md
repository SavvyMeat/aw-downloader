# API Documentation

## Base URL
```
http://localhost:3333/api
```

## Series Endpoints

### Get All Series
```http
GET /api/series
```

**Response:**
```json
[
  {
    "id": 1,
    "title": "Attack on Titan",
    "description": "A series about...",
    "status": "ongoing",
    "totalSeasons": 4,
    "posterUrl": "https://...",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "seasons": [...]
  }
]
```

### Create Series
```http
POST /api/series
Content-Type: application/json

{
  "title": "My Hero Academia",
  "description": "A world where people have superpowers",
  "status": "ongoing",
  "totalSeasons": 6,
  "posterUrl": "https://example.com/poster.jpg"
}
```

## Seasons Endpoints

### Get Seasons by Series
```http
GET /api/seasons/series/:seriesId
```

### Create Season
```http
POST /api/seasons
Content-Type: application/json

{
  "seriesId": 1,
  "seasonNumber": 2,
  "title": "Season 2",
  "totalEpisodes": 24,
  "status": "not_started",
  "releaseDate": "2024-04-01"
}
```

## Tasks Endpoints

### Get All Tasks
```http
GET /api/tasks
```

**Response:**
```json
[
  {
    "id": "update_metadata",
    "name": "Aggiornamento Metadati Sonarr",
    "description": "Aggiorna i metadati delle serie tramite API Sonarr",
    "intervalMinutes": 120,
    "cronExpression": "0 */2 * * *",
    "schedule": null,
    "lastRunAt": "2024-01-01T12:00:00.000Z",
    "nextRunAt": "2024-01-01T14:00:00.000Z",
    "status": "success",
    "lastError": null
  },
  {
    "id": "fetch_wanted",
    "name": "Recupero Lista Wanted",
    "description": "Recupera la lista degli episodi mancanti da Sonarr",
    "intervalMinutes": 30,
    "cronExpression": "*/30 * * * *",
    "schedule": null,
    "lastRunAt": null,
    "nextRunAt": "2024-01-01T12:30:00.000Z",
    "status": "idle",
    "lastError": null
  },
  {
    "id": "download_episodes",
    "name": "Download Episodi",
    "description": "Scarica gli episodi mancanti",
    "intervalMinutes": 60,
    "cronExpression": "0 */1 * * *",
    "schedule": null,
    "lastRunAt": null,
    "nextRunAt": "2024-01-01T13:00:00.000Z",
    "status": "idle",
    "lastError": null
  }
]
```

### Get Single Task
```http
GET /api/tasks/:id
```

**Parameters:**
- `id`: Task ID (update_metadata, fetch_wanted, download_episodes)

### Update Task Interval
```http
PUT /api/tasks/:id/interval
Content-Type: application/json

{
  "intervalMinutes": 60
}
```

**Parameters:**
- `id`: Task ID
- `intervalMinutes`: New interval in minutes (minimum: 1)

**Response:**
```json
{
  "id": "update_metadata",
  "name": "Aggiornamento Metadati Sonarr",
  "description": "Aggiorna i metadati delle serie tramite API Sonarr",
  "intervalMinutes": 60,
  "cronExpression": "0 */1 * * *",
  "schedule": null,
  "lastRunAt": null,
  "nextRunAt": "2024-01-01T13:00:00.000Z",
  "status": "idle",
  "lastError": null
}
```

**Notes:**
- All 3 tasks are hardcoded and always active
- Tasks cannot be disabled or deleted
- Interval changes are applied immediately
- Tasks are managed in memory (no database persistence for tasks)

## Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `404` - Not Found
- `500` - Internal Server Error

## Error Response Format
```json
{
  "message": "Error description",
  "error": "Detailed error message"
}
```
