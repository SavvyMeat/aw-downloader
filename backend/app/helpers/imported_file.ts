/**
 * What AW knows about the file it copied into the Sonarr/Radarr folder
 */
export interface CopiedFile {
  /** Id of the file linked to the episode/movie before the copy (usually none) */
  previousFileId: number | null
  /** Size in bytes of the copied file */
  size: number
}

/**
 * The file Sonarr/Radarr links to the episode/movie after the rescan
 */
export interface LinkedFile {
  id: number | null
  size: number | null
}

export type ImportedFileCheck = 'imported' | 'not_imported' | 'unchanged' | 'size_mismatch'

/**
 * Tell whether the file linked after the rescan is the one AW copied.
 *
 * Paths are not compared on purpose: Sonarr/Radarr keep the same file id and size when a
 * file is renamed or moved, while its path changes. The linked file must be new (not the
 * one linked before the copy) and have exactly the size of the copied file; otherwise it
 * may be another file imported by the same rescan (e.g. by another AW instance).
 */
export function checkImportedFile(copied: CopiedFile, linked: LinkedFile): ImportedFileCheck {
  if (!linked.id) {
    return 'not_imported'
  }
  if (linked.id === copied.previousFileId) {
    return 'unchanged'
  }
  if (linked.size !== copied.size) {
    return 'size_mismatch'
  }
  return 'imported'
}
