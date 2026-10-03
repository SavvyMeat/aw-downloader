import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'configs'

  async up() {
    const serialize = (val: any) => JSON.stringify(val)

    this.defer(async (db) => {
      // Add the option to set the audio language on imported files (disabled by
      // default: existing installs keep the language detected by Sonarr/Radarr).
      // Keys already saved from the settings page are kept as they are.
      await db
        .table(this.tableName)
        .multiInsert([
          { key: 'sonarr_audio_language_enabled', value: serialize(false) },
          { key: 'radarr_audio_language_enabled', value: serialize(false) },
        ])
        .knexQuery.onConflict('key')
        .ignore()
    })
  }

  async down() {
    this.defer(async (db) => {
      await db
        .from(this.tableName)
        .whereIn('key', ['sonarr_audio_language_enabled', 'radarr_audio_language_enabled'])
        .delete()
    })
  }
}
