"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { PhotoUpload } from "@/components/photo-upload";
import { submitOnboarding, getUploadUrl } from "./actions";
import type { PhotoKind } from "@/lib/storage";
import { feetInchesToInches } from "@/lib/height";

function extFor(file: File): "jpg" | "jpeg" | "png" | "webp" | "heic" {
  const map: Record<string, "jpg" | "jpeg" | "png" | "webp" | "heic"> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
  };
  return map[file.type] ?? "jpg";
}

async function uploadPhoto(kind: PhotoKind, file: File): Promise<string> {
  const { path, signedUrl } = await getUploadUrl(kind, extFor(file));
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return path;
}

export function OnboardingForm() {
  const [beforePhoto, setBeforePhoto] = useState<File | null>(null);
  const [goalPhoto, setGoalPhoto] = useState<File | null>(null);
  const [goalDescription, setGoalDescription] = useState("");
  const [heightFeet, setHeightFeet] = useState(5);
  const [heightInches, setHeightInches] = useState(9);
  const [weightLbs, setWeightLbs] = useState(180);
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [minutesSession, setMinutesSession] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!goalPhoto && goalDescription.trim().length < 10) {
      setError("Upload a goal photo OR describe your goal in at least 10 characters.");
      return;
    }

    try {
      const [beforePath, goalPath] = await Promise.all([
        beforePhoto ? uploadPhoto("before", beforePhoto) : Promise.resolve(null),
        goalPhoto ? uploadPhoto("goal", goalPhoto) : Promise.resolve(null),
      ]);

      startTransition(() => {
        submitOnboarding({
          heightIn: feetInchesToInches(heightFeet, heightInches),
          weightLbs,
          maxDaysPerWeek: daysPerWeek,
          maxMinutesSession: minutesSession,
          goalDescription: goalDescription.trim() || null,
          beforePhotoPath: beforePath,
          goalPhotoPath: goalPath,
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <PhotoUpload
        label="Before photo (optional)"
        optional
        onChange={setBeforePhoto}
        onError={setError}
      />

      <div className="space-y-2">
        <Label>Height</Label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Input
              aria-label="Height (feet)"
              type="number"
              inputMode="numeric"
              min={3}
              max={8}
              value={heightFeet}
              onChange={(e) => setHeightFeet(Number(e.target.value))}
              onFocus={(e) => e.target.select()}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">ft</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              aria-label="Height (inches)"
              type="number"
              inputMode="numeric"
              min={0}
              max={11}
              value={heightInches}
              onChange={(e) => setHeightInches(Number(e.target.value))}
              onFocus={(e) => e.target.select()}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">in</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="weight">Weight (lbs)</Label>
        <Input
          id="weight"
          type="number"
          min={80}
          max={500}
          value={weightLbs}
          onChange={(e) => setWeightLbs(Number(e.target.value))}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="days">Max days per week</Label>
          <span className="text-sm text-muted-foreground">{daysPerWeek}</span>
        </div>
        <Slider
          id="days"
          min={1}
          max={7}
          step={1}
          value={[daysPerWeek]}
          onValueChange={(v) => setDaysPerWeek(Array.isArray(v) ? v[0] : v)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="minutes">Max minutes per session</Label>
          <span className="text-sm text-muted-foreground">{minutesSession}</span>
        </div>
        <Slider
          id="minutes"
          min={15}
          max={120}
          step={5}
          value={[minutesSession]}
          onValueChange={(v) => setMinutesSession(Array.isArray(v) ? v[0] : v)}
        />
      </div>

      <PhotoUpload
        label="Goal photo (optional if you describe your goal below)"
        optional
        onChange={setGoalPhoto}
        onError={setError}
      />

      <div className="space-y-2">
        <Label htmlFor="goal">Or describe your goal</Label>
        <Textarea
          id="goal"
          placeholder="e.g., lean + defined shoulders and back, maintain weight"
          value={goalDescription}
          onChange={(e) => setGoalDescription(e.target.value)}
          rows={3}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "Saving…" : "Let's build your plan →"}
      </Button>
    </form>
  );
}
