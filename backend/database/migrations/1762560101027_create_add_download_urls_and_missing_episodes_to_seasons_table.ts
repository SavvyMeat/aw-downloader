import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'seasons'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('download_urls').nullable() // JSON array of anime identifiers (slugs after /play/)
      table.integer('missing_episodes').defaultTo(0) // Number of missing episodes
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('download_urls')
      table.dropColumn('missing_episodes')
    })
  }
}