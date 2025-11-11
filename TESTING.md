# Test API Examples

## Testare le API con PowerShell

### Creare una Serie
```powershell
$body = @{
    title = "Attack on Titan"
    description = "In un mondo dove l'umanità vive dietro enormi mura"
    status = "completed"
    totalSeasons = 4
    posterUrl = "https://example.com/aot.jpg"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3333/api/series" -Method Post -Body $body -ContentType "application/json"
```

### Ottenere tutte le Serie
```powershell
Invoke-RestMethod -Uri "http://localhost:3333/api/series" -Method Get
```

### Creare una Stagione
```powershell
$body = @{
    seriesId = 1
    seasonNumber = 1
    title = "Stagione 1"
    totalEpisodes = 25
    status = "completed"
    releaseDate = "2013-04-07"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3333/api/seasons" -Method Post -Body $body -ContentType "application/json"
```

### Creare un Task
```powershell
# Tasks are hardcoded - cannot create new ones
# You can only update intervals
```

### Ottenere tutti i Tasks
```powershell
Invoke-RestMethod -Uri "http://localhost:3333/api/tasks" -Method Get
```

### Ottenere un Task Specifico
```powershell
Invoke-RestMethod -Uri "http://localhost:3333/api/tasks/update_metadata" -Method Get
```

### Aggiornare Intervallo Task
```powershell
$body = @{
    intervalMinutes = 60
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3333/api/tasks/update_metadata/interval" -Method Put -Body $body -ContentType "application/json"
```

## Testare con curl (se disponibile)

### Creare una Serie
```bash
curl -X POST http://localhost:3333/api/series \
  -H "Content-Type: application/json" \
  -d '{
    "title": "One Piece",
    "description": "Le avventure di Monkey D. Luffy",
    "status": "ongoing",
    "totalSeasons": 20,
    "posterUrl": "https://example.com/onepiece.jpg"
  }'
```

### Ottenere Task Attivi
```bash
curl http://localhost:3333/api/tasks
```

### Aggiornare Intervallo Task
```bash
curl -X PUT http://localhost:3333/api/tasks/fetch_wanted/interval \
  -H "Content-Type: application/json" \
  -d '{"intervalMinutes": 15}'
```
