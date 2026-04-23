"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export type PhotoUploadProps = {
  /** Presentational label: "Before photo", "Goal photo", etc. */
  label: string;
  /** Optional: surface errors at the parent */
  onError?: (msg: string) => void;
  /** Fires with the selected File (or null if cleared) */
  onChange: (file: File | null) => void;
  /** Allow skipping entirely — renders a "No thanks" button */
  optional?: boolean;
};

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_BYTES = 10 * 1024 * 1024;

export function PhotoUpload({ label, onError, onChange, optional }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);

  const handleFile = (file: File | null) => {
    if (!file) {
      setPreviewUrl(null);
      onChange(null);
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      onError?.(`Unsupported file type: ${file.type}. Use JPG/PNG/WEBP/HEIC.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      onError?.(`File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Max 10 MB.`);
      return;
    }
    setPreviewUrl(URL.createObjectURL(file));
    setSkipped(false);
    onChange(file);
  };

  if (skipped) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{label} skipped.</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setSkipped(false);
            onChange(null);
          }}
        >
          Change my mind
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        {optional && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSkipped(true);
              setPreviewUrl(null);
              onChange(null);
            }}
          >
            Skip
          </Button>
        )}
      </div>

      {previewUrl ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="preview"
            className="w-full max-h-80 object-cover rounded-lg border"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleFile(null)}
          >
            Remove
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full h-40 border-2 border-dashed rounded-lg flex items-center justify-center text-sm text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
        >
          Tap to choose an image
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
