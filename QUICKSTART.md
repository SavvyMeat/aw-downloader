# Quick Start Guide

## Avvio Rapido del Progetto

### 1. Avviare il Backend
Apri un terminale PowerShell:
```powershell
cd d:\Documenti\PROGETTI\my-anime-download\backend
npm run dev
```

Il backend sarà disponibile su: `http://localhost:3333`

### 2. Avviare il Frontend
Apri un **secondo** terminale PowerShell:
```powershell
cd d:\Documenti\PROGETTI\my-anime-download\frontend
npm run dev
```

Il frontend sarà disponibile su: `http://localhost:3000`

### 3. Testare i Task

Non è necessario popolare il database per i task. I 3 task sono configurati automaticamente:

1. **Aggiornamento Metadati Sonarr** - ogni 2 ore
2. **Recupero Lista Wanted** - ogni 30 minuti  
3. **Download Episodi** - ogni 1 ora

Puoi modificare gli intervalli dalla pagina **Impostazioni**.

### 4. Accedere all'Applicazione

1. Apri il browser su `http://localhost:3000`
2. Verrai reindirizzato automaticamente alla Dashboard
4. Usa il menu hamburger (☰) in alto a sinistra per navigare tra:
   - **Dashboard**: Pagina principale
   - **Lista**: Gestione anime
   - **Tasks**: Visualizza i 3 task programmati con countdown alla prossima esecuzione
   - **Impostazioni**: Configura gli intervalli di esecuzione dei task

### 5. Testare le API

Verifica che il backend funzioni:
```powershell
# Test endpoint base
Invoke-RestMethod -Uri "http://localhost:3333" -Method Get

# Ottenere tutti i task
Invoke-RestMethod -Uri "http://localhost:3333/api/tasks" -Method Get

# Aggiornare intervallo task
$body = @{ intervalMinutes = 45 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3333/api/tasks/fetch_wanted/interval" -Method Put -Body $body -ContentType "application/json"
```

## Struttura Database

### Tabelle Create
- `series` - Serie anime
- `seasons` - Stagioni delle serie

### Task Configurati (In-Memory)
I task sono gestiti in memoria e includono:
1. **update_metadata** - Aggiornamento Metadati Sonarr
2. **fetch_wanted** - Recupero Lista Wanted
3. **download_episodes** - Download Episodi

### Modelli Disponibili
- `Series` - con relazione hasMany verso Seasons
- `Season` - con relazione belongsTo verso Series

## Funzionalità Chiave

### Sistema di Task Automatici
- 3 task hardcoded sempre attivi
- Configurazione intervalli in tempo reale dalla pagina Impostazioni
- Tracking automatico di:
  - Ultima esecuzione (`lastRunAt`)
  - Prossima esecuzione (`nextRunAt`) con countdown
  - Stato corrente (`idle`, `running`, `success`, `error`)
- Visualizzazione in tempo reale nella pagina Tasks
- Auto-refresh ogni 5 secondi
- Gestione completamente in memoria (no database per i task)

### API REST Complete
- **Series**: CRUD completo
- **Seasons**: CRUD completo + filtro per serie
- **Tasks**: Lista e configurazione intervalli (3 task hardcoded)

## Troubleshooting

### Backend non si avvia
- Verifica che la porta 3333 non sia occupata
- Controlla che tutte le dipendenze siano installate: `npm install`
- Verifica le migrazioni: `node ace migration:run`

### Frontend non si connette al Backend
- Controlla che il backend sia in esecuzione
- Verifica il file `.env.local` nel frontend
- L'URL API dovrebbe essere: `http://localhost:3333`

### Tasks non vengono visualizzati
- I 3 task vengono creati automaticamente all'avvio del backend
- Verifica che il backend sia in esecuzione
- Controlla la console del browser per errori
- I task sono sempre attivi e non richiedono configurazione iniziale

## Prossimi Passi

1. Implementare la logica di download nei task
2. Aggiungere interfaccia per creare/modificare serie e stagioni
3. Implementare sistema di autenticazione
4. Aggiungere notifiche per nuovi episodi
