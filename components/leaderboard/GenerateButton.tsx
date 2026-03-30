"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "done" | "needs-env" | "error";

export default function GenerateButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");

  async function handleClick() {
    setStatus("loading");
    setMessage("");
    setSubscriptionId("");
    try {
      const res = await fetch("/api/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong.");
        return;
      }
      if (data.needsEnvUpdate) {
        setStatus("needs-env");
        setSubscriptionId(data.subscriptionId);
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

      {status === "error" && (
        <span className="text-xs text-right" style={{ color: "#c0392b" }}>{message}</span>
      )}

      {status === "needs-env" && (
        <div className="text-xs rounded-lg p-2 text-right" style={{ background: "rgba(37,99,168,0.07)", border: "1px solid rgba(37,99,168,0.2)", color: "#1a1040" }}>
          <p className="font-semibold mb-1">One-time setup needed</p>
          <p className="mb-1">Set this in Vercel → Environment Variables:</p>
          <code
            className="block rounded px-2 py-1 mb-1 select-all cursor-text"
            style={{ background: "rgba(0,0,0,0.06)", fontFamily: "monospace" }}
          >
            ORB_SUBSCRIPTION_ID={subscriptionId}
          </code>
          <p style={{ color: "#5a5070" }}>Then redeploy. Future generate runs won&apos;t need this.</p>
        </div>
      )}
    </div>
  );
}
