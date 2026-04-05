import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'configs'

  async up() {
    this.defer(async (db) => {
      // Rename existing Sonarr config keys
      await db
        .from(this.tableName)
        .where('key', 'fetchwanted_interval')
        .update({ key: 'sonarr_fetchwanted_interval' })

      await db
        .from(this.tableName)
        .where('key', 'updatemetadata_interval')
        .update({ key: 'sonarr_updatemetadata_interval' })
    })
  }

  async down() {
    this.defer(async (db) => {
      // Rename Sonarr config keys back
      await db
        .from(this.tableName)
        .where('key', 'sonarr_fetchwanted_interval')
        .update({ key: 'fetchwanted_interval' })

      await db
        .from(this.tableName)
        .where('key', 'sonarr_updatemetadata_interval')
        .update({ key: 'updatemetadata_interval' })
    })
  }
}