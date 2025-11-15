import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'configs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('key').notNullable().unique()
      table.string('value').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })

    const serialize = (val: any) => JSON.stringify(val)

    // Insert default values for configs
    this.defer(async (db) => {
      await db.table(this.tableName).multiInsert([
        { key: 'sonarr_url', value: serialize(null) },
        { key: 'sonarr_token', value: serialize(null) },
        { key: 'fetchwanted_interval', value: serialize(30) },
        { key: 'updatemetadata_interval', value: serialize(720) },
        { key: 'download_max_workers', value: serialize(3) },
        { key: 'concurrent_downloads', value: serialize(2) },
        { key: 'animeworld_base_url', value: serialize(null) },
        { key: 'sonarr_auto_rename', value: serialize(true) },
        { key: 'sonarr_filter_anime_only', value: serialize(true) },
        { key: 'sonarr_tags_mode', value: serialize('blacklist') },
        { key: 'sonarr_tags', value: serialize([]) },
      ])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}