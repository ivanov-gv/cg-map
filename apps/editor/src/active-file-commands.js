// The one path for every edit made in a mode. The file is never an argument: forms, keyboard, geometry tools and
// history can only reach the active file, and with no active file they cannot reach anything. Importing a reviewed
// changeset is the one deliberate exception, because a changeset names its own files.
export function createActiveFileCommands(session, activeFile) {
  const requireActiveFile = () => {
    const filename = activeFile();
    if (!filename) throw new Error('No source file is active.');
    return filename;
  };
  return {
    recordEdit: (key, after) => session.recordEdit(requireActiveFile(), key, after),
    undo: () => session.undo(requireActiveFile()),
    redo: () => session.redo(requireActiveFile())
  };
}
