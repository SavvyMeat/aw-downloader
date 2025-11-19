# AW Downloader

Applicazione full-stack per la gestione automatica dei download di anime da AnimeWorld tramite integrazione con Sonarr.

## ✨ Funzionalità Principali

### 📺 Gestione Serie e Stagioni
- **Sincronizzazione automatica** con Sonarr per importare serie anime monitorate
- **Ricerca automatica** degli anime su AnimeWorld con matching intelligente dei titoli
- **Supporto multi-parte**: gestione automatica di anime con più parti (es: "One Piece Part 2")
- **Numerazione assoluta**: supporto per serie con numerazione continua attraverso le stagioni
- **Filtro lingua**: preferenza per versioni doppiate o sottotitolate con fallback automatico

### 🔄 Task Automatici Configurabili
L'applicazione esegue automaticamente diversi task periodici:

- **Sincronizzazione Metadati**: aggiorna informazioni di serie, stagioni ed episodi da Sonarr
- **Recupero Lista Wanted**: identifica gli episodi mancanti e li aggiunge alla coda di download

Ogni task può essere configurato con un intervallo personalizzato (da 15 minuti a 2 giorni) e può essere eseguito manualmente pagina Tasks.

### ⚙️ Impostazioni

#### Configurazione Sonarr
- **URL e Token API**: connessione al server Sonarr
- **Filtro Solo Anime**: considera solo le serie con tipologia "Anime"
- **Rinomina Automatica**: rinomina i file dopo l'importazione secondo lo schema di Sonarr
- **Modalità Tag**:
  - **Escludi**: esclude serie con determinati tag
  - **Includi**: include solo serie con determinati tag
- **Tag**: Elenco dei tag per cui è valida la regola del punto sopra

#### Root Folders
- **Mappatura percorsi**: converti i percorsi di Sonarr in percorsi locali del container

#### AnimeWorld
- **URL Base configurabile**: supporto per cambio url di riferimento animeworld
- **Lingua preferita globale**: imposta la preferenza predefinita (dub/sub/dub con fallback)

#### Download
- **Worker simultanei**: numero di richieste in parallelo per singolo download (1-10)
- **Download simultanei**: numero massimo di download contemporanei nella coda (1-10)

### 📊 Dashboard e Monitoraggio
- Visualizzazione della coda di download
- Log delle operazioni

## 🚀 Deploy con Docker

L'applicazione è progettata per funzionare in Docker con frontend e backend unificati.

### Quick Start

```bash
# 1. Build immagine
docker compose build
# 2. Genera l'APP_KEY (richiesto per la sicurezza)
docker run --rm aw-downloader:latest keygen
# 3. Impostare la variabile d'ambiente APP_KEY=<chaive> nel file compose.yaml

# 4. Avvia con Docker Compose
docker-compose up -d
```

> **Nota importante**: L'APP_KEY è necessaria per la sicurezza dell'applicazione. Assicurati di generarla e configurarla prima del primo avvio.



## 🛠️ Sviluppo Locale

### Prerequisiti
- Node.js 20+
- npm o yarn

### Backend (AdonisJS)

```bash
cd backend
npm install
npm run dev
```

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```