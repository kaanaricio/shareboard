import { useId, useRef, useState } from "react";
import { OTPFieldPreview as OTPField } from "@base-ui/react/otp-field";
import { LockKeyhole } from "lucide-react";
import { SharedCanvas } from "@/components/shared-canvas";
import { useMountEffect } from "@/lib/use-mount-effect";
import {
  LOCKED_SHARE_PIN_LENGTH,
  cleanPin,
  decryptLockedCanvas,
  isCompletePin,
} from "@/lib/encrypted-share";
import type { Canvas, EncryptedCanvasEnvelope } from "@/lib/types";

export function LockedCanvas({
  id: boardId,
  initialPageIndex = 0,
}: {
  id: string;
  initialPageIndex?: number;
}) {
  const id = useId();
  const [pin, setPin] = useState("");
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [error, setError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const objectUrlsRef = useRef<string[]>([]);

  const revokeObjectUrls = () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  };

  useMountEffect(() => revokeObjectUrls);

  const unlock = async (value = pin) => {
    const nextPin = cleanPin(value);
    if (!isCompletePin(nextPin) || unlocking) return;
    setUnlocking(true);
    setError("");
    try {
      revokeObjectUrls();
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock", id: boardId, pin: nextPin }),
      });
      if (!res.ok) throw new Error("Unlock failed");
      const envelope = (await res.json()) as EncryptedCanvasEnvelope;
      const result = await decryptLockedCanvas(envelope, nextPin);
      objectUrlsRef.current = result.objectUrls;
      setCanvas(result.canvas);
    } catch {
      setPin("");
      setError("Incorrect PIN.");
    } finally {
      setUnlocking(false);
    }
  };

  if (canvas) return <SharedCanvas canvas={canvas} initialPageIndex={initialPageIndex} />;

  return (
    <div className="locked-share-screen">
      <form className="locked-share-card locked-share-card--inline">
        <div className="locked-share-icon" aria-hidden>
          <LockKeyhole className="h-5 w-5" />
        </div>
        <label htmlFor={id} className="locked-share-title">
          Enter PIN
        </label>
        <p className="locked-share-copy">Enter the 6-digit PIN to unlock.</p>
        <OTPField.Root
          id={id}
          length={LOCKED_SHARE_PIN_LENGTH}
          value={pin}
          onValueChange={(value) => {
            setError("");
            setPin(cleanPin(value));
          }}
          onValueComplete={(value) => void unlock(value)}
          validationType="numeric"
          inputMode="numeric"
          autoComplete="one-time-code"
          mask
          disabled={unlocking}
          className="locked-share-otp"
        >
          {Array.from({ length: LOCKED_SHARE_PIN_LENGTH }, (_, index) => (
            <OTPField.Input
              key={index}
              className="locked-share-otp-input"
              aria-label={`PIN digit ${index + 1} of ${LOCKED_SHARE_PIN_LENGTH}`}
            />
          ))}
        </OTPField.Root>
        <p className="locked-share-error" aria-live="polite">
          {error}
        </p>
      </form>
    </div>
  );
}
