"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const handleGoogleSignIn = async () => {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      console.error(error);
      alert(`Sign-in failed: ${error.message}`);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Trainer</h1>
        <p className="text-muted-foreground mt-2">
          Your personal Claude-powered coach.
        </p>
      </div>
      <Button onClick={handleGoogleSignIn} size="lg" className="w-full max-w-xs">
        Continue with Google
      </Button>
    </main>
  );
}
