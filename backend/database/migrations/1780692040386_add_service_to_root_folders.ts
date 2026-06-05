import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'root_folders'

  async up() {
    // Make root folders multi-service (Sonarr + Radarr):
    // add a `service` discriminator and turn the arr id into a generic `service_id`.
    this.schema.alterTable(this.tableName, (table) => {
      table.string('service').notNullable().defaultTo('sonarr')
      table.dropUnique(['sonarr_id'])
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('sonarr_id', 'service_id')
    })
    this.schema.alterTable(this.tableName, (table) => {
      // The arr id is only unique within a service, not globally
      table.unique(['service', 'service_id'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['service', 'service_id'])
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('service_id', 'sonarr_id')
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('service')
      table.unique(['sonarr_id'])
    })
  }
}
