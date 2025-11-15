import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'series'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('sonarr_id').notNullable().unique()
      table.string('title').notNullable()
      table.text('description').nullable()
      table.string('status').defaultTo('ongoing') // ongoing, completed, cancelled
      table.integer('total_seasons').defaultTo(0)
      table.string('poster_url').nullable()
      table.json('alternate_titles').nullable()
      table.text('genres').nullable()
      table.integer('year').nullable()
      table.string('network').nullable()
      table.string('poster_path').nullable()
      table.timestamp('poster_downloaded_at').nullable()
      table.boolean('deleted').defaultTo(false)

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}