import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'seasons'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('series_id').unsigned().references('id').inTable('series').onDelete('CASCADE')
      table.integer('season_number').notNullable()
      table.string('title').notNullable()
      table.integer('total_episodes').defaultTo(0)
      table.string('status').defaultTo('not_started') // not_started, downloading, completed
      table.date('release_date').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}