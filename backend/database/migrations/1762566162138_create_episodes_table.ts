import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'episodes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      
      table.integer('series_id').unsigned().notNullable().references('id').inTable('series').onDelete('CASCADE')
      table.integer('season_id').unsigned().notNullable().references('id').inTable('seasons').onDelete('CASCADE')
      table.integer('sonarr_id').unsigned().notNullable().unique()
      table.integer('season_number').notNullable()
      table.integer('episode_number').notNullable()
      table.string('title').notNullable()
      table.text('overview').nullable()
      table.timestamp('air_date_utc').nullable()
      table.boolean('has_file').defaultTo(false) // Se l'episodio è presente sul disco
      table.boolean('monitored').defaultTo(true)
      table.enum('aired_status', ['aired', 'not_aired']).defaultTo('not_aired')
      table.enum('disk_status', ['missing', 'downloaded']).defaultTo('missing')

      table.timestamp('created_at')
      table.timestamp('updated_at')
      
      // Index for faster queries
      table.index(['series_id', 'season_number', 'episode_number'])
      table.index('sonarr_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}