"use client";

import { useState } from "react";

interface CopyButtonProps {
  text: string;
  idleLabel?: string;
  className?: string;
}

export function CopyButton({ text, idleLabel = "Copy", className = "copy-button" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    let didCopy = false;
    try {
      await navigator.clipboard.writeText(text);
      didCopy = true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      didCopy = document.execCommand("copy");
      textarea.remove();
    }

    setCopied(didCopy);
    if (didCopy) window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button className={className} onClick={() => void copy()} type="button">
      {copied ? "Copied" : idleLabel}
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
      <rect x="5.5" y="5.5" width="7.5" height="8" rx="1" fill="none" stroke="currentColor" />
      <path d="M3 10.5H2.5A1.5 1.5 0 0 1 1 9V2.5A1.5 1.5 0 0 1 2.5 1H9a1.5 1.5 0 0 1 1.5 1.5V3" fill="none" stroke="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
      <path d="m2.5 8.5 3.25 3.25 7.5-8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}
