import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'seasons'

  async up() {
    // Convert existing full URLs to identifiers
    // URLs are in format: https://www.animeworld.so/play/one-piece.12345
    // We need to extract: one-piece.12345
    
    const seasons = await this.db.from(this.tableName).select('id', 'download_urls')
    
    for (const season of seasons) {
      if (!season.download_urls) continue
      
      try {
        const urls = JSON.parse(season.download_urls)
        if (!Array.isArray(urls) || urls.length === 0) continue
        
        // Convert each URL to identifier
        const identifiers = urls.map((url: string) => {
          // Extract the part after /play/
          const match = url.match(/\/play\/(.+)$/)
          return match ? match[1] : url // If no match, keep as-is (might already be an identifier)
        })
        
        // Update the record
        await this.db
          .from(this.tableName)
          .where('id', season.id)
          .update({ download_urls: JSON.stringify(identifiers) })
      } catch (error) {
        // Skip malformed JSON
        console.error(`Failed to convert downloadUrls for season ${season.id}:`, error)
      }
    }
  }

  async down() {
    // No down migration - we can't reconstruct the original URLs
    // since the domain might have changed
    console.log('Cannot revert downloadUrls conversion - original URLs are lost')
  }
}