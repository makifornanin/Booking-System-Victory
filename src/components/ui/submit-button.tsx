"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

interface SubmitButtonProps extends ButtonProps {
  pendingLabel?: string;
  /** Extra pending signal, e.g. from useTransition. */
  pending?: boolean;
}

export function SubmitButton({ children, pendingLabel, pending, ...props }: SubmitButtonProps) {
  const status = useFormStatus();
  return (
    <Button type="submit" busy={pending || status.pending} busyLabel={pendingLabel} {...props}>
      {children}
    </Button>
  );
}
