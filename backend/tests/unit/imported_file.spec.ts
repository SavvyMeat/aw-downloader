import { test } from '@japa/runner'
import { checkImportedFile } from '../../app/helpers/imported_file.js'

test.group('checkImportedFile', () => {
  test('accepts a new file with the size of the copied one', ({ assert }) => {
    assert.equal(
      checkImportedFile({ previousFileId: null, size: 514355224 }, { id: 42, size: 514355224 }),
      'imported'
    )
  })

  test('accepts a new file replacing a previous one', ({ assert }) => {
    assert.equal(
      checkImportedFile({ previousFileId: 7, size: 1000 }, { id: 42, size: 1000 }),
      'imported'
    )
  })

  test('reports a file not imported when nothing is linked', ({ assert }) => {
    assert.equal(
      checkImportedFile({ previousFileId: null, size: 1000 }, { id: null, size: null }),
      'not_imported'
    )
  })

  test('reports the file linked before the copy as unchanged', ({ assert }) => {
    // The rescan did not import the copied file: the episode keeps its previous file
    assert.equal(
      checkImportedFile({ previousFileId: 7, size: 1000 }, { id: 7, size: 1000 }),
      'unchanged'
    )
  })

  test('rejects a new file of another size', ({ assert }) => {
    // e.g. the same episode imported from another AW instance by the same rescan
    assert.equal(
      checkImportedFile({ previousFileId: null, size: 514355224 }, { id: 42, size: 518508971 }),
      'size_mismatch'
    )
  })
})
