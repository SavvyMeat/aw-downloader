import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'series'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('title').notNullable()
      table.text('description').nullable()
      table.string('status').defaultTo('ongoing') // ongoing, completed, cancelled
      table.integer('total_seasons').defaultTo(0)
      table.string('poster_url').nullable()
      table.integer('sonarr_id').nullable().unique()
      table.json('alternate_titles').nullable()
      table.text('genres').nullable()
      table.integer('year').nullable()
      table.string('network').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}