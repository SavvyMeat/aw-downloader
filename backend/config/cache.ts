import { defineConfig, store, drivers } from '@adonisjs/cache'

const cacheConfig = defineConfig({
  default: 'memory',

  stores: {
    memory: store().useL1Layer(drivers.memory({
        maxSize: '50mb',
        maxEntrySize: '10mb',
        maxItems: 1000
      })),
  }
})

export default cacheConfig

declare module '@adonisjs/cache/types' {
  interface CacheStores extends InferStores<typeof cacheConfig> {}
}