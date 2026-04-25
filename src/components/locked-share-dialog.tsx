import { useId, useState } from "react";
import { OTPFieldPreview as OTPField } from "@base-ui/react/otp-field";
import { LockKeyhole, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  LOCKED_SHARE_PIN_LENGTH,
  cleanPin,
  isCompletePin,
} from "@/lib/encrypted-share";

export function LockedShareDialog({
  open,
  busy,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (pin: string) => void;
}) {
  const id = useId();
  const [pin, setPin] = useState("");

  const close = (nextOpen: boolean) => {
    if (!nextOpen && busy) return;
    if (!nextOpen) setPin("");
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="locked-share-dialog sm:max-w-[390px]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isCompletePin(pin)) onCreate(pin);
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4" />
              Lock board
            </DialogTitle>
            <p className="locked-share-copy">Choose a 6-digit PIN.</p>
          </DialogHeader>

          <label htmlFor={id} className="sr-only">
            Board PIN
          </label>
          <OTPField.Root
            id={id}
            length={LOCKED_SHARE_PIN_LENGTH}
            value={pin}
            onValueChange={(value) => setPin(cleanPin(value))}
            onValueComplete={(value) => onCreate(cleanPin(value))}
            validationType="numeric"
            inputMode="numeric"
            autoComplete="one-time-code"
            mask
            disabled={busy}
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

          <DialogFooter className="locked-share-actions">
            <Button type="button" variant="outline" disabled={busy} onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isCompletePin(pin) || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
