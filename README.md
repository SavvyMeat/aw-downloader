# My Anime Download

Progetto full-stack per la gestione dei download di anime, diviso in backend (AdonisJS) e frontend (Next.js).

## Struttura del Progetto

```
my-anime-download/
├── backend/          # API Backend con AdonisJS + TypeScript
└── frontend/         # Interfaccia Frontend con Next.js + shadcn/ui
```

## Backend (AdonisJS)

Il backend è costruito con AdonisJS in modalità API utilizzando TypeScript, SQLite come database e access tokens per l'autenticazione.

### Avvio del Backend

```powershell
cd backend
npm run dev
```

Il server sarà disponibile su `http://localhost:3333`

### Comandi Utili Backend

```powershell
# Installare le dipendenze
npm install

# Avviare in modalità sviluppo
npm run dev

# Compilare per produzione
npm run build

# Avviare in produzione
npm start

# Eseguire le migrazioni
node ace migration:run
```

## Frontend (Next.js)

Il frontend è costruito con Next.js 15, TypeScript, Tailwind CSS e shadcn/ui per i componenti UI.

### Funzionalità

- **Dashboard**: Pagina principale con panoramica e statistiche
- **Lista**: Gestione della lista degli anime
- **Tasks**: Monitoraggio dei task automatici programmati con cron
- **Impostazioni**: Configurazione dell'applicazione
- **Navigazione laterale**: Drawer per navigare tra le pagine

### Avvio del Frontend

```powershell
cd frontend
npm run dev
```

Il frontend sarà disponibile su `http://localhost:3000`

### Comandi Utili Frontend

```powershell
# Installare le dipendenze
npm install

# Avviare in modalità sviluppo
npm run dev

# Compilare per produzione
npm run build

# Avviare in produzione
npm start

# Aggiungere componenti shadcn/ui
npx shadcn@latest add [component-name]
```

## Tecnologie Utilizzate

### Backend
- **AdonisJS 6**: Framework Node.js TypeScript-first
- **TypeScript**: Type safety e migliore DX
- **SQLite**: Database embedded per facilità di sviluppo
- **Lucid ORM**: ORM di AdonisJS per gestione database
- **Access Tokens**: Sistema di autenticazione
- **node-cron**: Scheduler per task automatici programmati

### Frontend
- **Next.js 15**: Framework React con App Router
- **TypeScript**: Type safety
- **Tailwind CSS**: Utility-first CSS framework
- **shadcn/ui**: Componenti UI accessibili e personalizzabili
- **Lucide React**: Icone moderne e pulite

## Sviluppo

Per lavorare su entrambi i servizi contemporaneamente, apri due terminali separati:

**Terminale 1 - Backend:**
```powershell
cd backend
npm run dev
```

**Terminale 2 - Frontend:**
```powershell
cd frontend
npm run dev
```

## Funzionalità Implementate

### Modelli e Database
- **Series**: Gestione delle serie anime con titolo, descrizione, stato e poster
- **Seasons**: Stagioni associate alle serie con numero stagione, episodi e stato download

### Sistema di Task Automatici (In-Memory)

Il sistema include 3 task automatici hardcoded che vengono eseguiti in base a intervalli configurabili:

#### Task Disponibili:
1. **Aggiornamento Metadati Sonarr** (default: ogni 2 ore)
   - Sincronizza i metadati delle serie tramite API Sonarr
   
2. **Recupero Lista Wanted** (default: ogni 30 minuti)
   - Recupera la lista degli episodi mancanti da Sonarr
   
3. **Download Episodi** (default: ogni 1 ora)
   - Scarica gli episodi mancanti

#### Caratteristiche:
- ✅ Task sempre attivi (non disabilitabili)
- ✅ Gestiti completamente in memoria (no database)
- ✅ Intervalli configurabili dinamicamente dalla pagina Impostazioni
- ✅ Tracking automatico di:
  - Ultima esecuzione
  - Prossima esecuzione
  - Stato corrente (idle, running, success, error)
- ✅ Visualizzazione in tempo reale con auto-refresh ogni 5 secondi

### API Endpoints

#### Series
- `GET /api/series` - Lista tutte le serie
- `GET /api/series/:id` - Dettagli di una serie
- `POST /api/series` - Crea una nuova serie
- `PUT /api/series/:id` - Aggiorna una serie
- `DELETE /api/series/:id` - Elimina una serie

#### Seasons
- `GET /api/seasons` - Lista tutte le stagioni
- `GET /api/seasons/series/:seriesId` - Stagioni di una serie specifica
- `GET /api/seasons/:id` - Dettagli di una stagione
- `POST /api/seasons` - Crea una nuova stagione
- `PUT /api/seasons/:id` - Aggiorna una stagione
- `DELETE /api/seasons/:id` - Elimina una stagione

#### Tasks
- `GET /api/tasks` - Lista tutti i task (3 task hardcoded)
- `GET /api/tasks/:id` - Dettagli di un task
- `PUT /api/tasks/:id/interval` - Aggiorna l'intervallo di un task (in minuti)

### Sistema di Task Automatici
Il backend include un sistema completo di gestione task con:
- **CronHelper**: Classe helper per schedulare e gestire 3 task hardcoded
- Task sempre attivi e non disabilitabili
- Intervalli configurabili in tempo reale
- Tracking ultima esecuzione e prossima esecuzione
- Gestione errori e stati (idle, running, success, error)
- Auto-inizializzazione all'avvio del server
- Interfaccia web per monitoraggio e configurazione

### Pagine Frontend

#### Dashboard
Pagina principale con panoramica

#### Lista
Gestione della lista degli anime

#### Tasks
Visualizzazione in tempo reale dei 3 task automatici con:
- Stato corrente di esecuzione
- Countdown alla prossima esecuzione
- Ultima esecuzione
- Intervallo configurato
- Eventuali errori

#### Impostazioni
Configurazione degli intervalli di esecuzione per ciascun task:
- Input per modificare i minuti di intervallo
- Salvataggio immediato
- Feedback visivo delle modifiche

### Popolazione Database di Test
Per popolare il database con dati di esempio di serie e stagioni:
```powershell
cd backend
# TODO: Creare seeder per Series e Seasons
```

## Prossimi Passi

1. Implementare la logica di download effettiva nei task
2. Creare i componenti UI per la gestione delle serie nel frontend
3. Implementare il sistema di autenticazione completo
4. Aggiungere la gestione dei download
5. Implementare le impostazioni dell'applicazione

## Licenza

MIT
