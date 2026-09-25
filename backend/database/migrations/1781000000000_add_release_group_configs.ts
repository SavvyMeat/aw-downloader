import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'configs'

  async up() {
    const serialize = (val: any) => JSON.stringify(val)

    this.defer(async (db) => {
      // Add release group configurations (disabled by default: existing
      // installs keep the current filename format). Keys already saved from
      // the settings page are kept as they are.
      await db
        .table(this.tableName)
        .multiInsert([
          { key: 'sonarr_release_group_enabled', value: serialize(false) },
          { key: 'sonarr_release_group', value: serialize('AnimeWorld') },
          { key: 'radarr_release_group_enabled', value: serialize(false) },
          { key: 'radarr_release_group', value: serialize('AnimeWorld') },
        ])
        .knexQuery.onConflict('key')
        .ignore()
    })
  }

  async down() {
    this.defer(async (db) => {
      await db
        .from(this.tableName)
        .whereIn('key', [
          'sonarr_release_group_enabled',
          'sonarr_release_group',
          'radarr_release_group_enabled',
          'radarr_release_group',
        ])
        .delete()
    })
  }
}
