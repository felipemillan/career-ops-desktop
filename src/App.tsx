import { useState } from "react";
import reactLogo from "./assets/react.svg";
import "./App.css";
// All IPC goes through ipc.ts — do NOT import invoke directly here.
import { readApplications } from "./lib/ipc";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // Placeholder: in a real implementation this would call a named ipc wrapper.
    // Using readApplications as a stand-in to exercise the IPC layer from the UI.
    void name;
    try {
      const resp = await readApplications();
      setGreetMsg(resp.content.slice(0, 80) || "No applications yet.");
    } catch {
      setGreetMsg("Not connected to backend.");
    }
  }

  return (
    <main className="container">
      <h1>Welcome to Tauri + React</h1>

      <div className="row">
        <a href="https://vite.dev" target="_blank">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Greet</button>
      </form>
      <p>{greetMsg}</p>
    </main>
  );
}

export default App;
