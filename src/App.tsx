import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import "./App.css";

function App() {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Start writing…",
      }),
    ],
    autofocus: true,
  });

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      <main className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </main>
    </div>
  );
}

export default App;
