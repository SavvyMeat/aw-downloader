import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'configs'

  async up() {
    const serialize = (val: any) => JSON.stringify(val)

    this.defer(async (db) => {
      // Add Radarr configurations
      await db.table(this.tableName).multiInsert([
        { key: 'radarr_url', value: serialize(null) },
        { key: 'radarr_token', value: serialize(null) },
        { key: 'radarr_fetchwanted_interval', value: serialize(30) },
        { key: 'radarr_updatemetadata_interval', value: serialize(720) },
        { key: 'radarr_auto_rename', value: serialize(true) },
        { key: 'radarr_tags_mode', value: serialize('blacklist') },
        { key: 'radarr_tags', value: serialize([]) },
      ])
    })
  }

  async down() {
    this.defer(async (db) => {
      // Remove Radarr configurations
      await db
        .from(this.tableName)
        .whereIn('key', [
          'radarr_url',
          'radarr_token',
          'radarr_fetchwanted_interval',
          'radarr_updatemetadata_interval',
          'radarr_auto_rename',
          'radarr_tags_mode',
          'radarr_tags',
        ])
        .delete()
    })
  }
}
