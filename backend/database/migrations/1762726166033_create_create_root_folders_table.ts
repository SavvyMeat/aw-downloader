import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'root_folders'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('sonarr_id').unsigned().notNullable().unique()
      table.string('path').notNullable()
      table.string('mapped_path').nullable()
      table.boolean('accessible').defaultTo(true).notNullable()
      table.bigInteger('free_space').nullable()
      table.bigInteger('total_space').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}