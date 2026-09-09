/** Synthetic discovery graph: root song, shortcuts, duplicate/cyclic directory and distinct opaque IDs. */
export function createCurationDiscoveryFixture() {
  return {
    indexes: {
      index: [{ name: 'S', artist: [{ id: 'dir', name: 'Synthetic', album: [] }] }],
      shortcut: [{ id: 'shortcut', name: 'Synthetic shortcut' }],
      child: [{ id: 'root-track', isDir: false, title: 'Synthetic root', suffix: 'mp3' }],
      lastModified: 1,
    },
    directory(id: string) {
      return {
        id,
        child:
          id === 'shortcut'
            ? [{ id: 'dir', isDir: true as const, name: 'Same' }]
            : [
                { id: 'dir', isDir: true as const, name: 'Cycle' },
                { id: 'one', isDir: false as const, path: 'music/same.mp3' },
                { id: 'two', isDir: false as const, path: 'music/other.mp3' },
              ],
      };
    },
  };
}
