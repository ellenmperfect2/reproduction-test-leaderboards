"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "done" | "up-to-date" | "error";

export default function GenerateButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong.");
        return;
      }
      if (data.upToDate) {
        setStatus("up-to-date");
      } else {
        setStatus("done");
        setMessage(`Done — ${data.eventsIngested} events ingested. Refresh to see data.`);
      }
    } catch (err) {
      setStatus("error");
      setMessage(String(err));
    }
  }

  return (
    <div className="flex flex-col items-end gap-2 max-w-xs">
      <button
        onClick={handleClick}
        disabled={status === "loading"}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
        style={{ borderColor: "#2563a8", color: "#2563a8" }}
      >
        {status === "loading" ? "Generating…" : "Generate Example Data"}
      </button>

      {status === "done" && (
        <span className="text-xs text-right" style={{ color: "#2d6e3e" }}>{message}</span>
      )}

      {status === "up-to-date" && (
        <span className="text-xs text-right" style={{ color: "#2d6e3e" }}>Data is up to date!</span>
      )}

      {status === "error" && (
        <span className="text-xs text-right" style={{ color: "#c0392b" }}>{message}</span>
      )}
    </div>
  );
}
