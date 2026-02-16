// §3.3 DropHandler — drag-and-drop & paste image insertion
// Handles image files dropped or pasted into the editor,
// converting them to data URLs and inserting as image blocks.
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

/** Read a File as a data URL */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Extract image files from a DataTransfer */
function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (file.type.startsWith("image/")) {
      files.push(file);
    }
  }
  return files;
}

/** Create the drop handler ProseMirror plugin */
function createDropHandlerPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDrop(view, event) {
        if (!event.dataTransfer) return false;
        const files = getImageFiles(event.dataTransfer);
        if (files.length === 0) return false;

        event.preventDefault();

        const coords = { left: event.clientX, top: event.clientY };
        const pos = view.posAtCoords(coords);
        if (!pos) return false;

        const insertPos = pos.pos;

        for (const file of files) {
          readFileAsDataURL(file).then((dataUrl) => {
            const { tr } = view.state;
            const imageNode = view.state.schema.nodes.image.create({
              src: dataUrl,
              alt: file.name,
              title: null,
            });
            tr.insert(insertPos, imageNode);
            view.dispatch(tr);
          });
        }

        return true;
      },

      handlePaste(view, event) {
        if (!event.clipboardData) return false;
        const files = getImageFiles(event.clipboardData);
        if (files.length === 0) return false;

        event.preventDefault();

        for (const file of files) {
          readFileAsDataURL(file).then((dataUrl) => {
            const { tr } = view.state;
            const imageNode = view.state.schema.nodes.image.create({
              src: dataUrl,
              alt: file.name,
              title: null,
            });
            tr.replaceSelectionWith(imageNode);
            view.dispatch(tr);
          });
        }

        return true;
      },
    },
  });
}

/** Tiptap Extension wrapper */
export const DropHandler = Extension.create({
  name: "dropHandler",

  addProseMirrorPlugins() {
    return [createDropHandlerPlugin()];
  },
});
