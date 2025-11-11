/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

const SeriesController = () => import('#controllers/series_controller')
const SeasonsController = () => import('#controllers/seasons_controller')
const TasksController = () => import('#controllers/tasks_controller')
const ConfigsController = () => import('#controllers/configs_controller')
const DownloadQueueController = () => import('#controllers/download_queue_controller')
const LogsController = () => import('#controllers/logs_controller')
const RootFoldersController = () => import('#controllers/root_folders_controller')
const HealthController = () => import('#controllers/health_controller')

router.get('/', async () => {
  return {
    hello: 'world',
  }
})

// Series routes
router.group(() => {
  router.get('/', [SeriesController, 'index'])
  router.get('/:id', [SeriesController, 'show'])
  router.get('/:id/poster', [SeriesController, 'getPoster'])
  router.post('/', [SeriesController, 'store'])
  router.put('/:id', [SeriesController, 'update'])
  router.delete('/:id', [SeriesController, 'destroy'])
}).prefix('/api/series')

// Seasons routes
router.group(() => {
  router.get('/', [SeasonsController, 'index'])
  router.get('/series/:seriesId', [SeasonsController, 'bySeries'])
  router.get('/:id', [SeasonsController, 'show'])
  router.post('/', [SeasonsController, 'store'])
  router.put('/:id', [SeasonsController, 'update'])
  router.put('/:id/download-urls', [SeasonsController, 'updateDownloadUrls'])
  router.delete('/:id', [SeasonsController, 'destroy'])
}).prefix('/api/seasons')

// Tasks routes
router.group(() => {
  router.get('/', [TasksController, 'index'])
  router.get('/:id', [TasksController, 'show'])
  router.put('/:id/interval', [TasksController, 'updateInterval'])
  router.post('/:id/execute', [TasksController, 'execute'])
}).prefix('/api/tasks')

// Configs routes
router.group(() => {
  router.get('/', [ConfigsController, 'index'])
  router.get('/:key', [ConfigsController, 'show'])
  router.post('/', [ConfigsController, 'store'])
  router.put('/batch', [ConfigsController, 'updateBatch'])
  router.delete('/:key', [ConfigsController, 'destroy'])
}).prefix('/api/configs')

// Download Queue routes
router.group(() => {
  router.get('/', [DownloadQueueController, 'index'])
  router.get('/config', [DownloadQueueController, 'config'])
  router.post('/', [DownloadQueueController, 'store'])
  router.delete('/completed', [DownloadQueueController, 'clearCompleted'])
  router.delete('/:id', [DownloadQueueController, 'destroy'])
}).prefix('/api/download-queue')

// Logs routes
router.group(() => {
  router.get('/', [LogsController, 'index'])
  router.get('/stats', [LogsController, 'stats'])
  router.delete('/', [LogsController, 'clear'])
}).prefix('/api/logs')

// Root Folders routes
router.group(() => {
  router.get('/', [RootFoldersController, 'index'])
  router.post('/sync', [RootFoldersController, 'sync'])
  router.put('/:id/mapping', [RootFoldersController, 'updateMapping'])
}).prefix('/api/root-folders')

// Health check routes
router.group(() => {
  router.get('/sonarr', [HealthController, 'checkSonarr'])
  router.post('/sonarr/force', [HealthController, 'forceSonarrCheck'])
  router.get('/sonarr/status', [HealthController, 'getSonarrStatus'])
}).prefix('/api/health')
